import {
  AbstractMesh,
  LinesMesh,
  ActionManager,
  ArcRotateCamera,
  Color3,
  ExecuteCodeAction,
  Matrix,
  Mesh,
  MeshBuilder,
  Quaternion,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from '@babylonjs/core'
import { GridMaterial } from '@babylonjs/materials/grid/gridMaterial'

import type Ant from '../classes/ant'
import { getSpeed } from '../commons/simClock'
import {
  AUTODISCOVERING,
  FOOD_SITE_MAX,
  FOOD_SITE_MIN,
  FoodSpot,
  NEST_BASE_DIAMETER,
  SCOUTING,
  SITE_RADIUS_MAX,
  SYMBOL_SCALE,
  WORLD_SCALE,
  SLEEP_CHAMBER_RADIUS,
  SLEEP_POSITION,
  TASK_POSITIONS,
  TaskName,
} from '../constants'
import type { Colony } from '../model/colony'
import { MAX_LEVEL, SiteMarker, buildSiteMarker } from './siteMarkers'
import { TASK_COLOR3, TASK_ORDER } from '../ui/palette'

// Visual layer only: reads model state, never writes it. No text in 3D — the HUD is the
// legend. What the scene shows:
//   nest dome (centre) · sleep chamber below it · one tank per task site (fill = supply)
//   roads from the nest (thickness = ants on that task) · pulses and sparks for events.

// Sizes below are drawn for a world of 300 and multiplied by SYMBOL_SCALE (see constants).
const S = SYMBOL_SCALE
const GROUND_SIZE = 520 * S
const BASE_RADIUS = 340 * S
const WHEEL_PRECISION_AT_BASE = 1
const MARKER_HEIGHT = 30 * S // camera target when flying to a site
const FOCUS_RADIUS = 90 * S
const BASE_DIAMETER = 12 * S
const ROAD_MIN = 0.25 * S
const ROAD_MAX = 3.5 * S
const REFRESH_MS = 250
// Encounter pings (only for the selected task): at most this many per real second, each
// visible for PING_LIFE_S real seconds, so high sim speeds show a sample, not a blizzard.
const PINGS_PER_SECOND = 30
const PING_LIFE_S = 0.6
const DEATH = new Color3(0.45, 0.45, 0.43)
const WHITE = Color3.White()
const BLACK = Color3.Black()

interface Site {
  root: TransformNode
  /** Task silhouette; absent for Collect, whose places are the food spots. */
  marker: SiteMarker | null
  /** Eased supply level shown by the marker. */
  level: number
  road: Mesh
  roadMat: StandardMaterial
  known: number
}

/** One food spot on screen: a mound on a base, and its own road from the nest. */
interface FoodSpotView {
  spot: FoodSpot
  epoch: number
  root: TransformNode
  road: Mesh
  roadMat: StandardMaterial
  scale: number
}

interface Effect {
  mesh: Mesh
  mat: StandardMaterial
  age: number
  life: number
  from: number
  to: number
  alpha: number
  active: boolean
}

const material = (scene: Scene, name: string, color: Color3, alpha = 1, emissive = 0.35): StandardMaterial => {
  const mat = new StandardMaterial(name, scene)
  mat.diffuseColor = color.clone()
  mat.emissiveColor = color.scale(emissive)
  mat.specularColor = BLACK.clone()
  mat.alpha = alpha
  return mat
}

// Cylinder of height 1 whose origin sits at its bottom face, so scaling.y grows it upwards.
const bottomPivotCylinder = (name: string, diameter: number, scene: Scene): Mesh => {
  const mesh = MeshBuilder.CreateCylinder(name, { height: 1, diameter, tessellation: 24 }, scene)
  mesh.bakeTransformIntoVertices(Matrix.Translation(0, 0.5, 0))
  mesh.isPickable = false
  return mesh
}

// Orient a unit-height, bottom-pivot cylinder so it spans from `a` to `b`.
const span = (mesh: Mesh, a: Vector3, b: Vector3): void => {
  const dir = b.subtract(a)
  mesh.position.copyFrom(a)
  mesh.rotationQuaternion = mesh.rotationQuaternion ?? new Quaternion()
  Quaternion.FromUnitVectorsToRef(Vector3.Up(), dir.normalizeToNew(), mesh.rotationQuaternion)
  mesh.scaling.y = dir.length()
}

export class ColonyView {
  private sites = {} as Record<TaskName, Site>
  private nest!: Mesh
  private ground!: Mesh
  private chamberMat!: StandardMaterial
  private effects: Effect[] = []
  private rings: Effect[] = []
  private pings: Effect[] = []
  private pingBudget = PINGS_PER_SECOND
  private highlighted: TaskName | null = null
  private foodViews: FoodSpotView[] = []
  private perimeter!: TransformNode
  private perimeterRing!: LinesMesh
  /** Eased scouting supply shown by the perimeter's brightness. */
  private scoutLevel = 0

  constructor(
    private scene: Scene,
    private camera: ArcRotateCamera,
    private colony: Colony,
  ) {
    this.createGround()
    this.createNest()
    this.createPerimeter()
    TASK_ORDER.forEach((task) => this.createSite(task))
    // Food lives in several spots (createFoodSpotView); the single Collect site is retired.
    this.sites.Collect.root.setEnabled(false)
    // With scouting, nobody walks to an Exploration site: scouts cover the territory, so the
    // territory circle itself is the Exploration gauge (see animate), not a beacon.
    if (SCOUTING) {
      this.sites.Exploration.root.setEnabled(false)
      this.sites.Exploration.road.setEnabled(false)
    }
    this.sites.Collect.road.setEnabled(false)
    this.createEffectPools()

    camera.setTarget(Vector3.Zero())
    camera.radius = BASE_RADIUS
    camera.alpha = -Math.PI / 3
    camera.beta = 1.1
    window.addEventListener('keydown', (e) => {
      if (e.key === 'h' || e.key === 'H') this.focus(Vector3.Zero(), BASE_RADIUS)
    })

    scene.onBeforeRenderObservable.add(() => this.animate())
    this.refresh()
    setInterval(() => this.refresh(), REFRESH_MS)
  }

  // --- construction --------------------------------------------------------

  private createGround(): void {
    const ground = MeshBuilder.CreateGround('nest-level', { width: GROUND_SIZE, height: GROUND_SIZE }, this.scene)
    ground.isPickable = false
    this.ground = ground
    const grid = new GridMaterial('nest-level-grid', this.scene)
    grid.mainColor = BLACK.clone()
    grid.lineColor = new Color3(0.3, 0.3, 0.28)
    grid.opacity = 0.25
    grid.gridRatio = 20 * S
    grid.majorUnitFrequency = 5
    grid.minorUnitVisibility = 0.3
    grid.backFaceCulling = false
    ground.material = grid
  }

  /**
   * The colony's foraging territory: a dashed circle on the ground, where food spots appear.
   * Expansion widens it (food is pushed out as the nest digs), so it measures expansion.
   * Built once at radius 1 and scaled, so it can grow smoothly.
   */
  private createPerimeter(): void {
    const node = new TransformNode('perimeter', this.scene)
    // Babylon lays dashes PER SEGMENT and drops any segment shorter than one dash period,
    // so the circle needs fewer, longer segments than dashes (64 segments, 2 dashes each).
    const SEGMENTS = 64
    const points = Array.from({ length: SEGMENTS + 1 }, (_, i) => {
      const a = (i / SEGMENTS) * Math.PI * 2
      return new Vector3(Math.cos(a), 0.2, Math.sin(a))
    })
    const ring = MeshBuilder.CreateDashedLines(
      'perimeter:ring',
      { points, dashSize: 3, gapSize: 2, dashNb: SEGMENTS * 2 },
      this.scene,
    )
    ring.color = SCOUTING ? TASK_COLOR3.Exploration.clone() : new Color3(0.72, 0.7, 0.62)
    ring.alpha = 0.55
    this.perimeterRing = ring
    ring.isPickable = false
    ring.parent = node
    node.scaling.setAll(SITE_RADIUS_MAX * this.colony.foodReach)
    this.perimeter = node
  }

  private createNest(): void {
    // Dome above ground, sleep chamber below it, joined by a tunnel.
    // Built at the base diameter and scaled every frame, so digging is visible.
    const nest = MeshBuilder.CreateSphere(
      'nest',
      { diameter: NEST_BASE_DIAMETER, slice: 0.5, segments: 24 },
      this.scene,
    )
    this.nest = nest
    nest.material = material(this.scene, 'nest', new Color3(0.55, 0.42, 0.3), 0.9, 0.25)
    nest.isPickable = false

    const tunnel = bottomPivotCylinder('nest:tunnel', 2.5 * S, this.scene)
    span(tunnel, SLEEP_POSITION, Vector3.Zero())
    tunnel.material = material(this.scene, 'nest:tunnel', new Color3(0.55, 0.42, 0.3), 0.25, 0.15)

    const chamber = MeshBuilder.CreateSphere(
      'sleep-chamber',
      { diameter: SLEEP_CHAMBER_RADIUS * 2 + 4 * S, segments: 24 },
      this.scene,
    )
    chamber.position.copyFrom(SLEEP_POSITION)
    chamber.isPickable = false
    this.chamberMat = material(this.scene, 'sleep-chamber', new Color3(0.45, 0.5, 0.75), 0.08, 0.2)
    this.chamberMat.backFaceCulling = false
    chamber.material = this.chamberMat
  }

  private createSite(task: TaskName): void {
    const scene = this.scene
    const color = TASK_COLOR3[task]
    const pos = TASK_POSITIONS[task]

    const root = new TransformNode(`site:${task}`, scene)
    root.position.copyFrom(pos)

    const base = MeshBuilder.CreateCylinder(
      `site:${task}:base`,
      { height: 1 * S, diameter: BASE_DIAMETER, tessellation: 32 },
      scene,
    )
    base.parent = root
    base.material = material(scene, `site:${task}:base`, color, 0.9, 0.3)

    // What the task is (silhouette) and how well it is supplied (how complete it is).
    const marker = task === 'Collect' ? null : buildSiteMarker(task, scene, root, color)

    const road = bottomPivotCylinder(`site:${task}:road`, 1, scene)
    span(road, Vector3.Zero(), pos)
    const roadMat = material(scene, `site:${task}:road`, color, 0.2, 0.6)
    road.material = roadMat

    base.actionManager = new ActionManager(scene)
    base.actionManager.registerAction(
      new ExecuteCodeAction(ActionManager.OnPickTrigger, () =>
        this.focus(pos.add(new Vector3(0, MARKER_HEIGHT / 2, 0)), FOCUS_RADIUS),
      ),
    )

    this.sites[task] = { root, marker, level: 0, road, roadMat, known: AUTODISCOVERING ? 0 : 1 }
  }

  private createEffectPools(): void {
    const pool = (count: number, make: (i: number) => Mesh): Effect[] =>
      Array.from({ length: count }, (_, i) => {
        const mesh = make(i)
        const mat = material(this.scene, `${mesh.name}:mat`, WHITE, 0, 1)
        mat.disableLighting = true
        mesh.material = mat
        mesh.isPickable = false
        mesh.setEnabled(false)
        return { mesh, mat, age: 0, life: 1, from: 1, to: 1, alpha: 1, active: false }
      })
    this.effects = pool(48, (i) => MeshBuilder.CreateSphere(`fx:spark:${i}`, { diameter: 2.4 * S, segments: 8 }, this.scene))
    this.rings = pool(24, (i) =>
      MeshBuilder.CreateTorus(`fx:ring:${i}`, { diameter: 14 * S, thickness: 0.4 * S, tessellation: 32 }, this.scene),
    )
    // Small camera-facing rings for encounters. Two ants only "meet" when their bodies
    // overlap, so a line between them would be ~2 units long; a ring at the contact reads.
    this.pings = pool(40, (i) => {
      const ring = MeshBuilder.CreateTorus(`fx:ping:${i}`, { diameter: 4 * S, thickness: 0.35 * S, tessellation: 24 }, this.scene)
      ring.bakeTransformIntoVertices(Matrix.RotationX(Math.PI / 2))
      ring.billboardMode = Mesh.BILLBOARDMODE_ALL
      return ring
    })
  }

  // --- events from the model ------------------------------------------------

  /** An ant came home and delivered work for `task`. */
  delivered(task: TaskName): void {
    this.spawn(this.rings, Vector3.Zero(), TASK_COLOR3[task], 1, 2.2, 0.8, 0.45)
  }

  /** The queen laid an egg that became an ant. */
  born(): void {
    this.spawn(this.rings, Vector3.Zero(), WHITE, 0.4, 1.2, 0.8, 0.5)
  }

  died(at: Vector3): void {
    this.spawn(this.effects, at, DEATH, 1, 3, 1.4, 0.8)
  }

  /** Two ants met and one taught the other where a task site is. */
  knowledgeShared(at: Vector3): void {
    this.spawn(this.effects, at, WHITE, 0.6, 2, 0.6, 0.8)
  }

  /**
   * An encounter, as reported by `ant`. Shown only while a task is selected, and only for
   * that task's ants, coloured by the task of the ant they met: that is what drives their
   * sense of how crowded each job is.
   */
  encountered(ant: Ant, other: Ant): void {
    const task = this.highlighted
    if (!task || ant.data.behaviour.actualTask.type !== task) return
    // Both sides report a meeting; when both are on the selected task, draw it once.
    if (other.data.behaviour.actualTask.type === task && ant.data.id > other.data.id) return
    if (this.pingBudget < 1) return
    this.pingBudget -= 1
    const at = ant.data.body.position.add(other.data.body.position).scaleInPlace(0.5)
    this.spawn(this.pings, at, TASK_COLOR3[other.data.behaviour.actualTask.type], 0.6, 1.6, PING_LIFE_S, 0.95)
  }

  highlight(task: TaskName | null): void {
    this.highlighted = task
    this.refresh()
  }

  // --- per-frame / periodic -------------------------------------------------

  private spawn(pool: Effect[], at: Vector3, color: Color3, from: number, to: number, life: number, alpha: number): void {
    const fx = pool.find((e) => !e.active) ?? pool.reduce((a, b) => (a.age / a.life > b.age / b.life ? a : b))
    fx.active = true
    fx.age = 0
    fx.life = life
    fx.from = from
    fx.to = to
    fx.alpha = alpha
    fx.mat.emissiveColor.copyFrom(color)
    fx.mat.diffuseColor.copyFrom(color)
    fx.mesh.position.copyFrom(at)
    fx.mesh.scaling.setAll(from)
    fx.mesh.setEnabled(true)
  }

  private animate(): void {
    // Effects follow the sim speed (frozen when paused), like everything else.
    const dt = (this.scene.getEngine().getDeltaTime() / 1000) * getSpeed()
    const step = (fx: Effect): void => {
      if (!fx.active) return
      fx.age += dt
      const t = Math.min(fx.age / fx.life, 1)
      fx.mesh.scaling.setAll(fx.from + (fx.to - fx.from) * t)
      fx.mat.alpha = fx.alpha * (1 - t)
      if (t >= 1) {
        fx.active = false
        fx.mesh.setEnabled(false)
      }
    }
    this.effects.forEach(step)
    this.rings.forEach(step)

    // Pings run on real time (frozen while paused) so they stay readable at 16×.
    const realDt = getSpeed() > 0 ? this.scene.getEngine().getDeltaTime() / 1000 : 0
    this.pingBudget = Math.min(PINGS_PER_SECOND, this.pingBudget + realDt * PINGS_PER_SECOND)
    this.pings.forEach((fx) => {
      if (!fx.active) return
      fx.age += realDt
      const t = Math.min(fx.age / fx.life, 1)
      fx.mesh.scaling.setAll(fx.from + (fx.to - fx.from) * t)
      fx.mat.alpha = fx.alpha * (1 - t)
      if (t >= 1 || !this.highlighted) {
        fx.active = false
        fx.mesh.setEnabled(false)
      }
    })

    this.frameWorld()

    // The territory follows expansion, eased like the dome.
    const territory = SITE_RADIUS_MAX * this.colony.foodReach
    const r = this.perimeter.scaling.x + (territory - this.perimeter.scaling.x) * 0.05
    this.perimeter.scaling.set(r, 1, r)
    if (SCOUTING) this.paintPerimeter()

    // Digging widens the dome. Eased rather than snapped so growth reads as growth.
    const nestScale = this.colony.nestDiameter / NEST_BASE_DIAMETER
    this.nest.scaling.setAll(this.nest.scaling.x + (nestScale - this.nest.scaling.x) * 0.05)

    // Each food spot is as big as what is lying there: a seed stays small, a crumb of bread
    // is unmistakable from across the world, and both visibly shrink as ants carry them off.
    this.syncFoodSpots()
    const logSpan = Math.log(FOOD_SITE_MAX / FOOD_SITE_MIN)
    this.foodViews.forEach((v) => {
      const { spot } = v
      const size = Math.log(Math.max(FOOD_SITE_MIN, spot.initial) / FOOD_SITE_MIN) / logSpan
      const fullness = spot.initial > 0 ? Math.max(0, spot.remaining / spot.initial) : 0
      const target = (0.55 + 1.45 * size) * (0.35 + 0.65 * fullness)
      v.scale += (target - v.scale) * 0.12
      v.root.scaling.setAll(v.scale)
    })

    // Under-served tanks breathe so the eye finds them without reading anything.
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 260)
    TASK_ORDER.forEach((task) => {
      if (task === 'Collect' || (SCOUTING && task === 'Exploration')) return
      const site = this.sites[task]
      const { need, actual } = this.colony.needs[task]
      const supply = need > 0 ? actual / need : MAX_LEVEL
      const starving = supply < 0.25 && site.known > 0
      if (!site.marker) return
      site.marker.mat.emissiveColor.copyFrom(TASK_COLOR3[task]).scaleInPlace(starving ? 0.3 + 0.5 * pulse : 0.45)
      const target = Math.max(0, Math.min(supply, MAX_LEVEL))
      site.level += (target - site.level) * 0.15
      site.marker.setLevel(site.level)
    })
  }

  /**
   * Keep the camera and the ground big enough for what the world has become.
   *
   * Both were fixed at build time: the zoom ceiling at WORLD_SCALE × 1.8 and the grid at
   * 520 across. Once expansion started pushing food spots outward, a spot could sit past
   * both — too far to zoom out to, and floating over nothing when you got there.
   *
   * The ceiling is raised, never lowered, and the camera is never moved: zooming stays the
   * player's. The grid only ever grows, because a grid that shrank under you as the colony
   * ate through a distant spot would read as the world moving.
   */
  private frameWorld(): void {
    let extent = this.colony.nestDiameter
    TASK_ORDER.forEach((task) => {
      if (task !== 'Collect') extent = Math.max(extent, TASK_POSITIONS[task].length())
    })
    this.colony.foodSpots.forEach((spot) => (extent = Math.max(extent, spot.position.length())))

    const needed = extent * 2.2 + this.colony.nestDiameter
    this.camera.upperRadiusLimit = Math.max(WORLD_SCALE * 1.8, needed)

    // Zoom steps are a division by wheelPrecision, so a constant value crawls once you are
    // far out. Scale it with distance to keep a scroll worth the same fraction of the view.
    this.camera.wheelPrecision = Math.max(0.08, WHEEL_PRECISION_AT_BASE * (BASE_RADIUS / Math.max(1, this.camera.radius)))

    const wantGround = Math.max(GROUND_SIZE, extent * 2.4)
    const scale = wantGround / GROUND_SIZE
    if (scale > this.ground.scaling.x) this.ground.scaling.setAll(scale)
  }

  private refresh(): void {
    const ants = this.colony.ants
    const total = ants.length || 1
    const onTask = Object.fromEntries(TASK_ORDER.map((t) => [t, 0])) as Record<TaskName, number>
    const knownBy = Object.fromEntries(TASK_ORDER.map((t) => [t, 0])) as Record<TaskName, number>
    let asleep = 0

    ants.forEach((ant) => {
      const behaviour = ant.data.behaviour
      const task = behaviour.actualTask.type
      if (ant.isSleeping) asleep++
      else onTask[task]++
      TASK_ORDER.forEach((t) => {
        if (behaviour.discoveredPositions[t]) knownBy[t]++
      })
      this.paintAnt(ant, task)
    })

    // The chamber glows a little brighter the more of the colony is asleep in it.
    this.chamberMat.alpha = 0.06 + 0.25 * Math.sqrt(asleep / total)

    this.refreshFoodSpots(total)

    TASK_ORDER.forEach((task) => {
      if (task === 'Collect' || (SCOUTING && task === 'Exploration')) return
      const site = this.sites[task]
      site.known = AUTODISCOVERING ? knownBy[task] / total : 1
      const share = onTask[task] / total
      const discovered = site.known > 0
      const dim = this.highlighted !== null && this.highlighted !== task

      // Undiscovered sites are ghosts with no road: they exist, but no ant knows the way yet.
      const fade = (dim ? 0.15 : 1) * (discovered ? 1 : 0.3)
      site.root.getChildMeshes().forEach((m) => (m.visibility = fade))
      // Scouts roam the territory rather than walking to the beacon, so it gets no road.
      site.road.setEnabled(discovered && !(SCOUTING && task === 'Exploration'))
      const width = ROAD_MIN + (ROAD_MAX - ROAD_MIN) * Math.sqrt(share)
      site.road.scaling.x = width
      site.road.scaling.z = width
      site.roadMat.alpha = (0.12 + 0.6 * Math.sqrt(share)) * (dim ? 0.15 : 1)
    })
  }

  /**
   * Scouting gauge: the territory circle, in the Exploration colour, is as bright as scouting
   * keeps up with its need (actual ÷ need), and breathes when it is badly under-served.
   * Same reading rule as every site: brighter/fuller = better supplied.
   */
  private paintPerimeter(): void {
    const { need, actual } = this.colony.needs.Exploration
    const supply = need > 0 ? Math.min(MAX_LEVEL, actual / need) : MAX_LEVEL
    this.scoutLevel += (supply - this.scoutLevel) * 0.1
    const level = this.scoutLevel / MAX_LEVEL
    const starving = supply < 0.25
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 260)
    const dim = this.highlighted !== null && this.highlighted !== 'Exploration'
    const lit = this.highlighted === 'Exploration'
    const base = 0.15 + 0.75 * level
    this.perimeterRing.alpha = (starving ? base * (0.5 + 0.5 * pulse) : base) * (dim ? 0.25 : 1)
    this.perimeterRing.color.copyFrom(TASK_COLOR3.Exploration).scaleInPlace(lit ? 1.4 : 1)
  }

  // --- food spots ------------------------------------------------------------

  private createFoodSpotView(spot: FoodSpot): FoodSpotView {
    const scene = this.scene
    const color = TASK_COLOR3.Collect
    const root = new TransformNode(`food:${spot.id}`, scene)
    root.position.copyFrom(spot.position)

    const base = MeshBuilder.CreateCylinder(`food:${spot.id}:base`, { height: 0.6 * S, diameter: BASE_DIAMETER, tessellation: 32 }, scene)
    base.parent = root
    base.material = material(scene, `food:${spot.id}:base`, color, 0.55, 0.25)
    const mound = MeshBuilder.CreateSphere(`food:${spot.id}:mound`, { diameter: BASE_DIAMETER * 0.8, slice: 0.5, segments: 20 }, scene)
    mound.parent = root
    mound.position.y = 0.3 * S
    mound.material = material(scene, `food:${spot.id}:mound`, color, 0.95, 0.45)
    mound.isPickable = true
    mound.actionManager = new ActionManager(scene)
    mound.actionManager.registerAction(
      new ExecuteCodeAction(ActionManager.OnPickTrigger, () => this.focus(spot.position.clone(), FOCUS_RADIUS)),
    )

    const road = bottomPivotCylinder(`food:${spot.id}:road`, 1, scene)
    span(road, Vector3.Zero(), spot.position)
    const roadMat = material(scene, `food:${spot.id}:road`, color, 0.2, 0.6)
    road.material = roadMat
    return { spot, epoch: spot.epoch, root, road, roadMat, scale: 0.01 }
  }

  /** New spots appear as the foraging area grows; a respawned spot moves (new epoch). */
  private syncFoodSpots(): void {
    // Spots can disappear (a poorer environment does not replace emptied ones): drop their views.
    const alive = new Set(this.colony.foodSpots)
    this.foodViews = this.foodViews.filter((v) => {
      if (alive.has(v.spot)) return true
      v.root.dispose()
      v.road.dispose()
      return false
    })
    this.colony.foodSpots.forEach((spot) => {
      const view = this.foodViews.find((v) => v.spot === spot)
      if (!view) {
        this.foodViews.push(this.createFoodSpotView(spot))
        return
      }
      if (view.epoch !== spot.epoch) {
        view.epoch = spot.epoch
        view.root.position.copyFrom(spot.position)
        span(view.road, Vector3.Zero(), spot.position)
        view.scale = 0.01 // grows in from nothing, so a respawn reads as a new find
      }
    })
  }

  /**
   * Road width = collectors heading for this spot as it is now. A spot nobody knows is a
   * ghost with no road; ants still walking to an emptied spot's old place do not count.
   */
  private refreshFoodSpots(total: number): void {
    const users = new Map<FoodSpot, number>()
    const knowers = new Map<FoodSpot, number>()
    this.colony.ants.forEach((ant) => {
      const m = ant.foodMemory
      if (!m || m.epoch !== m.spot.epoch) return
      knowers.set(m.spot, (knowers.get(m.spot) ?? 0) + 1)
      if (!ant.isSleeping && ant.data.behaviour.actualTask.type === 'Collect') users.set(m.spot, (users.get(m.spot) ?? 0) + 1)
    })
    const dim = this.highlighted !== null && this.highlighted !== 'Collect'
    this.foodViews.forEach((v) => {
      const known = (knowers.get(v.spot) ?? 0) > 0 || !AUTODISCOVERING
      const share = (users.get(v.spot) ?? 0) / total
      const fade = (dim ? 0.15 : 1) * (known ? 1 : 0.3)
      v.root.getChildMeshes().forEach((m) => (m.visibility = fade))
      v.road.setEnabled(known)
      const width = ROAD_MIN + (ROAD_MAX - ROAD_MIN) * Math.sqrt(share)
      v.road.scaling.x = width
      v.road.scaling.z = width
      v.roadMat.alpha = (0.12 + 0.6 * Math.sqrt(share)) * (dim ? 0.15 : 1)
    })
  }

  private paintAnt(ant: Ant, task: TaskName): void {
    const mesh = ant.data.body as AbstractMesh | null
    const mat = mesh?.material as StandardMaterial | null
    if (!mesh || !mat) return
    mat.diffuseColor.copyFrom(TASK_COLOR3[task])
    if (ant.isSleeping) {
      // Asleep: keeps its task colour, but unlit and half transparent.
      mat.emissiveColor.copyFrom(BLACK)
    } else if (ant.hadDiscoveredAllTargets()) {
      // The model marks ants that know every site with a white glow; keep that signal.
      mat.emissiveColor.copyFrom(WHITE)
    } else {
      mat.emissiveColor.copyFrom(TASK_COLOR3[task]).scaleInPlace(0.55)
    }
    const visible = this.highlighted === null || this.highlighted === task
    mesh.visibility = (visible ? 1 : 0.08) * (ant.isSleeping ? 0.5 : 1)
  }

  private focus(target: Vector3, radius: number): void {
    this.camera.setTarget(target.clone())
    this.camera.radius = radius
  }
}
