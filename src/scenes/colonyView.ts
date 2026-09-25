import {
  AbstractMesh,
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
  NEST_BASE_DIAMETER,
  WORLD_SCALE,
  SLEEP_CHAMBER_RADIUS,
  SLEEP_POSITION,
  TASK_POSITIONS,
  TaskName,
} from '../constants'
import type { Colony } from '../model/colony'
import { TASK_COLOR3, TASK_ORDER } from '../ui/palette'

// Visual layer only: reads model state, never writes it. No text in 3D — the HUD is the
// legend. What the scene shows:
//   nest dome (centre) · sleep chamber below it · one tank per task site (fill = supply)
//   roads from the nest (thickness = ants on that task) · pulses and sparks for events.

const GROUND_SIZE = 520
const BASE_RADIUS = 340
const WHEEL_PRECISION_AT_BASE = 1
const TANK_HEIGHT = 30
const TANK_DIAMETER = 6
const BASE_DIAMETER = 12
const TANK_OVERFLOW = 1.5 // fill may rise to 150% of the tube so over-supply is visible
const ROAD_MIN = 0.25
const ROAD_MAX = 3.5
const REFRESH_MS = 250
const DEATH = new Color3(0.45, 0.45, 0.43)
const WHITE = Color3.White()
const BLACK = Color3.Black()

interface Site {
  root: TransformNode
  fill: Mesh
  road: Mesh
  roadMat: StandardMaterial
  fillMat: StandardMaterial
  known: number
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
  private highlighted: TaskName | null = null

  constructor(
    private scene: Scene,
    private camera: ArcRotateCamera,
    private colony: Colony,
  ) {
    this.createGround()
    this.createNest()
    TASK_ORDER.forEach((task) => this.createSite(task))
    this.createEffectPools()

    camera.setTarget(Vector3.Zero())
    camera.radius = 340
    camera.alpha = -Math.PI / 3
    camera.beta = 1.1
    window.addEventListener('keydown', (e) => {
      if (e.key === 'h' || e.key === 'H') this.focus(Vector3.Zero(), 340)
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
    grid.gridRatio = 20
    grid.majorUnitFrequency = 5
    grid.minorUnitVisibility = 0.3
    grid.backFaceCulling = false
    ground.material = grid
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

    const tunnel = bottomPivotCylinder('nest:tunnel', 2.5, this.scene)
    span(tunnel, SLEEP_POSITION, Vector3.Zero())
    tunnel.material = material(this.scene, 'nest:tunnel', new Color3(0.55, 0.42, 0.3), 0.25, 0.15)

    const chamber = MeshBuilder.CreateSphere(
      'sleep-chamber',
      { diameter: SLEEP_CHAMBER_RADIUS * 2 + 4, segments: 24 },
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
      { height: 1, diameter: BASE_DIAMETER, tessellation: 32 },
      scene,
    )
    base.parent = root
    base.material = material(scene, `site:${task}:base`, color, 0.9, 0.3)

    const tube = bottomPivotCylinder(`site:${task}:tube`, TANK_DIAMETER, scene)
    tube.parent = root
    tube.position.y = 0.5
    tube.scaling.y = TANK_HEIGHT
    const tubeMat = material(scene, `site:${task}:tube`, WHITE, 0.1, 0.05)
    tubeMat.backFaceCulling = false
    tube.material = tubeMat

    const fill = bottomPivotCylinder(`site:${task}:fill`, TANK_DIAMETER - 1.2, scene)
    fill.parent = root
    fill.position.y = 0.5
    const fillMat = material(scene, `site:${task}:fill`, color, 0.95, 0.45)
    fill.material = fillMat

    const road = bottomPivotCylinder(`site:${task}:road`, 1, scene)
    span(road, Vector3.Zero(), pos)
    const roadMat = material(scene, `site:${task}:road`, color, 0.2, 0.6)
    road.material = roadMat

    base.actionManager = new ActionManager(scene)
    base.actionManager.registerAction(
      new ExecuteCodeAction(ActionManager.OnPickTrigger, () =>
        this.focus(pos.add(new Vector3(0, TANK_HEIGHT / 2, 0)), 90),
      ),
    )

    this.sites[task] = { root, fill, road, roadMat, fillMat, known: AUTODISCOVERING ? 0 : 1 }
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
    this.effects = pool(48, (i) => MeshBuilder.CreateSphere(`fx:spark:${i}`, { diameter: 2.4, segments: 8 }, this.scene))
    this.rings = pool(24, (i) =>
      MeshBuilder.CreateTorus(`fx:ring:${i}`, { diameter: 14, thickness: 0.4, tessellation: 32 }, this.scene),
    )
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

    this.frameWorld()

    // Digging widens the dome. Eased rather than snapped so growth reads as growth.
    const nestScale = this.colony.nestDiameter / NEST_BASE_DIAMETER
    this.nest.scaling.setAll(this.nest.scaling.x + (nestScale - this.nest.scaling.x) * 0.05)

    // The food spot is as big as what is lying there: a seed stays small, a crumb of bread
    // is unmistakable from across the world, and both visibly shrink as ants carry them off.
    const logSpan = Math.log(FOOD_SITE_MAX / FOOD_SITE_MIN)
    const size = Math.log(Math.max(FOOD_SITE_MIN, this.colony.foodSiteInitial) / FOOD_SITE_MIN) / logSpan
    const foodScale = (0.55 + 1.45 * size) * (0.35 + 0.65 * this.colony.foodSiteFullness)
    const collect = this.sites.Collect
    const foodAt = TASK_POSITIONS.Collect
    if (!collect.root.position.equals(foodAt)) {
      // The spot moved. The road was spanned once at creation, so it has to be re-aimed or
      // it keeps pointing at ground the food has already left.
      collect.root.position.copyFrom(foodAt)
      span(collect.road, Vector3.Zero(), foodAt)
    }
    collect.root.scaling.setAll(collect.root.scaling.x + (foodScale - collect.root.scaling.x) * 0.12)

    // Under-served tanks breathe so the eye finds them without reading anything.
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 260)
    TASK_ORDER.forEach((task) => {
      const site = this.sites[task]
      const { need, actual } = this.colony.needs[task]
      const supply = need > 0 ? actual / need : TANK_OVERFLOW
      const starving = supply < 0.25 && site.known > 0
      site.fillMat.emissiveColor.copyFrom(TASK_COLOR3[task]).scaleInPlace(starving ? 0.3 + 0.5 * pulse : 0.45)
      const target = Math.max(0.02, Math.min(supply, TANK_OVERFLOW)) * TANK_HEIGHT
      site.fill.scaling.y += (target - site.fill.scaling.y) * 0.15
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
      extent = Math.max(extent, TASK_POSITIONS[task].length())
    })

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

    TASK_ORDER.forEach((task) => {
      const site = this.sites[task]
      site.known = AUTODISCOVERING ? knownBy[task] / total : 1
      const share = onTask[task] / total
      const discovered = site.known > 0
      const dim = this.highlighted !== null && this.highlighted !== task

      // Undiscovered sites are ghosts with no road: they exist, but no ant knows the way yet.
      const fade = (dim ? 0.15 : 1) * (discovered ? 1 : 0.3)
      site.root.getChildMeshes().forEach((m) => (m.visibility = fade))
      site.road.setEnabled(discovered)
      const width = ROAD_MIN + (ROAD_MAX - ROAD_MIN) * Math.sqrt(share)
      site.road.scaling.x = width
      site.road.scaling.z = width
      site.roadMat.alpha = (0.12 + 0.6 * Math.sqrt(share)) * (dim ? 0.15 : 1)
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
