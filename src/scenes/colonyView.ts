import {
  AbstractMesh,
  ActionManager,
  ArcRotateCamera,
  Color3,
  DynamicTexture,
  ExecuteCodeAction,
  HighlightLayer,
  Matrix,
  Mesh,
  MeshBuilder,
  Quaternion,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
  VertexBuffer,
  VertexData,
} from '@babylonjs/core'
import { GridMaterial } from '@babylonjs/materials/grid/gridMaterial'

import type Ant from '../classes/ant'
import { getSpeed, simNow } from '../commons/simClock'
import {
  AUTODISCOVERING,
  FOOD_SITE_MAX,
  FOOD_SPOT_RADIUS,
  MIDDEN_RADIUS,
  FOOD_SITE_MIN,
  FoodSpot,
  NEST_BASE_DIAMETER,
  NEST_CLEARING,
  DEBRIS,
  EXPERIMENT_FROZEN_GROUND,
  PATROL_BAND,
  LIFESPAN_MEAN_MS,
  INTERIOR_TASKS,
  TRAILS,
  TRAILS_ON,
  NO_ENTRY_ON,
  TERRAIN,
  groundAt,
  isUnderground,
  NEST_BOWL,
  SEARCHING_RADIUS,
  SCOUTING,
  SURFACE_Y,
  SITE_RADIUS_MAX,
  SYMBOL_SCALE,
  WORLD_SCALE,
  SLEEP_CHAMBER_RADIUS,
  SLEEP_POSITION,
  TASK_POSITIONS,
  TaskName,
} from '../constants'
import type { Colony } from '../model/colony'
import { NestView, SLEEP_TINT, bowlMaterial, glassOf, roomShell } from './nestView'

export type NestLayer = 'surface' | 'underground'
/** Tasks done underground: highlighting one shows the underground view. */
const UNDERGROUND_TASKS: TaskName[] = ['QueenCare', 'EggLarvePupeaCare', 'Store', 'Expansion']
const UNDERGROUND_SKY = new Color3(0.07, 0.05, 0.035)
/** The solid soil, toned like the old half-see-through one over the dark background. */
const SOIL_TONE = 0.62
/** Height of the protected band's edge kerbs: below an ant's size (1 unit for workers). */
const BAND_KERB_HEIGHT = 0.6
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
/** Underground bowl at zero expansion: wide and deep enough for every chamber. */
const BOWL_BASE_RADIUS = 2 * SEARCHING_RADIUS
const BASE_DIAMETER = 12 * S
const ROAD_MIN = 0.25 * S
const ROAD_MAX = 3.5 * S
const ROAD_POINTS = 48
const FENCE_PANELS = 96
const FENCE_HEIGHT = 4.5 * S
const REFRESH_MS = 250
// Encounter pings (only for the selected task): at most this many per real second, each
// visible for PING_LIFE_S real seconds, so high sim speeds show a sample, not a blizzard.
const PINGS_PER_SECOND = 30
const PING_LIFE_S = 0.6
const DEATH = new Color3(0.45, 0.45, 0.43)
const WHITE = Color3.White()
const ICE = new Color3(0.86, 0.93, 1)
const WATER = new Color3(0.16, 0.32, 0.5)
/** Pale colour of a callow (newly emerged) worker. */
const CALLOW = new Color3(0.93, 0.9, 0.84)
/** Callows darken to full colour over this much sim time (~15% of a mean life). */
const CALLOW_MS = 0.15 * LIFESPAN_MEAN_MS
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
  /** The seeds lying there: fewer as ants carry them off. */
  seeds: Mesh
  seedCount: number
}

// Every surface spot follows one visual grammar: a RING on the ground in its task's colour
// (the HUD is the legend) and, inside it, the real stuff that shows its state: a pile of seeds
// at a food spot, a heap of refuse at the midden.

/**
 * Matrices for `count` pieces heaped in a pile around the local origin: `radius` wide,
 * `height` tall at the centre, sloping to the edge. Deterministic, so a pile doesn't reshuffle
 * when it changes size.
 */
const pileMatrices = (count: number, radius: number, height: number, size: number, seed = 0, tilt = 0.8): Float32Array => {
  const m = new Float32Array(count * 16)
  for (let i = 0; i < count; i++) {
    const a = (i + seed) * 2.399963
    const t = Math.sqrt(((i * 0.618034 + seed * 0.131) % 1) * 0.95 + 0.05)
    const y = height * (1 - t * t) * (0.55 + 0.45 * ((i * 0.37) % 1))
    const k = size * (0.7 + 0.6 * ((i * 0.71) % 1))
    const at = new Vector3(Math.cos(a) * radius * t, y + k * 0.3, Math.sin(a) * radius * t)
    const turn = Quaternion.RotationYawPitchRoll(i * 1.3, ((i * 0.29) % 1) * tilt, ((i * 0.53) % 1) * tilt)
    Matrix.Compose(new Vector3(k, k, k), turn, at).copyToArray(m, i * 16)
  }
  return m
}

/**
 * A leaf lying flat: a pointed lens `length` long, gently curled, with both faces drawn.
 * Food spots are a few fallen leaves; foragers carry a piece of one home.
 */
const leafMesh = (scene: Scene, name: string, length: number): Mesh => {
  const leaf = MeshBuilder.CreateDisc(name, { radius: length / 2, tessellation: 18, sideOrientation: Mesh.DOUBLESIDE }, scene)
  const p = leaf.getVerticesData(VertexBuffer.PositionKind)!
  for (let i = 0; i < p.length; i += 3) {
    const u = p[i] / (length / 2) // −1 … 1 along the leaf
    const taper = Math.sqrt(Math.max(0, 1 - u * u))
    p[i + 1] *= 0.45 * taper // narrow, pointed at both ends
    p[i + 2] = -0.12 * length * (1 - u * u) * 0.5 // a slight curl
  }
  leaf.updateVerticesData(VertexBuffer.PositionKind, p)
  leaf.rotation.x = Math.PI / 2 // lie flat
  leaf.bakeCurrentTransformIntoVertices()
  leaf.isPickable = false
  return leaf
}

/** A flat ring lying on the ground, in a task's colour: the spot's legend mark. */
const groundRing = (scene: Scene, name: string, radius: number, color: Color3): Mesh => {
  const ring = MeshBuilder.CreateTorus(name, { diameter: radius * 2, thickness: 0.9 * S, tessellation: 40 }, scene)
  ring.scaling.y = 0.35
  ring.position.y = 0.25 * S
  ring.material = material(scene, `${name}:mat`, color, 1, 0.6)
  ring.isPickable = false
  return ring
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

const pos3 = (v: Vector3): Vector3 => v

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
  /** Glow outline, in the task's colour, around everything that belongs to the selected task. */
  private glow!: HighlightLayer
  private glowing = new Set<Mesh>()
  private glowTask: TaskName | null = null
  private foodViews: FoodSpotView[] = []
  private perimeter!: TransformNode
  private perimeterMat!: StandardMaterial
  private fence!: Mesh
  private fenceMatrices!: Float32Array
  private fenceRadius = 0
  private grid!: GridMaterial
  private frostMat: StandardMaterial | null = null
  private trailTexture: DynamicTexture | null = null
  private soilMat!: StandardMaterial
  private waterMat!: StandardMaterial
  private bowl: Mesh | null = null
  private band: Mesh | null = null
  private bandMat!: StandardMaterial
  private bandEdgeMat!: StandardMaterial
  private bandEdges: Mesh[] = []
  private bandOuter = 0
  private debrisMeshes = {} as Record<'spoil' | 'scrap' | 'corpse', Mesh>
  private debrisSeen = -1
  private middenHeap: Mesh | null = null
  private middenPieces = {} as Record<'spoil' | 'scrap' | 'corpse', Mesh>
  private middenCount = -1
  private middenBase: Mesh | null = null
  private carryMeshes = new WeakMap<Ant, Mesh>()
  private seedMat!: StandardMaterial
  private leafMat!: StandardMaterial
  private pebbleMat!: StandardMaterial
  private nestView!: NestView
  private digBranch: Mesh | null = null
  private sleepChamber: Mesh | null = null
  /** Built underground parts drawn here (shaft, queen's tunnel, sleep chamber); the rest is NestView. */
  private interior: Mesh[] = []
  private rocks: Mesh[] = []
  private trailOverlay: Mesh | null = null
  /**
   * Two views instead of one see-through one. Surface: the ground is solid, the underground is
   * hidden (its footprint shows as worked soil). Underground: the surface fades to a ghost
   * overhead and rooms, tunnels and contents are solid. `viewChoice` is the user's; the view
   * shown also goes underground while the camera is below the ground or an underground task is
   * highlighted.
   */
  private viewChoice: NestLayer = 'surface'
  private shown: NestLayer | null = null
  private viewListeners: ((view: NestLayer) => void)[] = []
  /** How visible surface things are in the current view (1 on the surface, faint underground). */
  private surfaceFade = 1
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
    // Protection is an area now (the patrol band); the palisade marker steps aside.
    this.sites.Protection.root.setEnabled(false)
    this.sites.Protection.road.setEnabled(false)
    // The midden is a real refuse heap now; the stones marker steps aside.
    this.sites.Cleaning.root.setEnabled(false)
    this.createGroundLife()
    // The rooms show these now (seeds, brood, the queen); their silhouettes step aside.
    // The digging front is the room being dug, drawn in the Expansion colour (NestView): no marker.
    ;(['QueenCare', 'EggLarvePupeaCare', 'Store', 'Expansion'] as TaskName[]).forEach((t) => this.sites[t].root.setEnabled(false))
    // With scouting, nobody walks to an Exploration site: scouts cover the territory, so the
    // territory circle itself is the Exploration gauge (see animate), not a beacon.
    if (SCOUTING) {
      this.sites.Exploration.root.setEnabled(false)
      this.sites.Exploration.road.setEnabled(false)
    }
    this.sites.Collect.road.setEnabled(false)
    this.createEffectPools()
    this.glow = new HighlightLayer('task-glow', scene, { blurHorizontalSize: 0.8, blurVerticalSize: 0.8 })
    this.glow.innerGlow = false

    camera.setTarget(Vector3.Zero())
    camera.radius = BASE_RADIUS
    camera.alpha = -Math.PI / 3
    camera.beta = 1.1
    window.addEventListener('keydown', (e) => {
      if (e.key === 'h' || e.key === 'H') this.focus(Vector3.Zero(), BASE_RADIUS)
    })

    this.updateView()
    scene.onBeforeRenderObservable.add(() => this.animate())
    this.refresh()
    setInterval(() => this.refresh(), REFRESH_MS)
  }

  // --- construction --------------------------------------------------------

  /** A ground mesh shaped like the terrain (the heightmap), `lift` units above it. */
  private terrainMesh(name: string, lift = 0): Mesh {
    const side = TERRAIN.half * 2
    const mesh = MeshBuilder.CreateGround(name, { width: side, height: side, subdivisions: TERRAIN.size, updatable: true }, this.scene)
    const positions = mesh.getVerticesData(VertexBuffer.PositionKind)!
    for (let i = 0; i < positions.length; i += 3) positions[i + 1] = groundAt(positions[i], positions[i + 2]) + lift
    mesh.updateVerticesData(VertexBuffer.PositionKind, positions)
    const normals: number[] = []
    VertexData.ComputeNormals(positions, mesh.getIndices()!, normals)
    mesh.updateVerticesData(VertexBuffer.NormalKind, normals)
    // Babylon keeps the flat plane's bounds after a reshape; refresh them or hills get culled.
    mesh.refreshBoundingInfo()
    mesh.isPickable = false
    return mesh
  }

  private createGround(): void {
    // The ground is the terrain now: hills and hollows from the heightmap, level at the nest.
    // A LIT soil layer gives the hills light and shade; the grid lines sit just above it.
    const soil = this.terrainMesh('soil')
    const soilMat = new StandardMaterial('soil', this.scene)
    soilMat.specularColor = BLACK.clone()
    // Solid in the surface view; a faint ghost overhead in the underground view (applyView).
    soilMat.backFaceCulling = false
    soil.material = soilMat
    this.soilMat = soilMat

    // Water fills the lowest hollows: one surface at the water level, which the terrain hides
    // wherever the ground is higher. Rocks: low-poly outcrops. Neither can be walked through.
    // Only where the ground really is below water: a flat sheet at the water level whose
    // vertices fade to fully transparent wherever the terrain rises above it. (A plain plane
    // showed through the see-through soil everywhere and tinted the whole ground blue.)
    const side = TERRAIN.half * 2
    const water = MeshBuilder.CreateGround('water', { width: side, height: side, subdivisions: TERRAIN.size }, this.scene)
    water.position.y = TERRAIN.waterLevel
    water.isPickable = false
    const wp = water.getVerticesData(VertexBuffer.PositionKind)!
    const colors = new Float32Array((wp.length / 3) * 4)
    for (let i = 0, c = 0; i < wp.length; i += 3, c += 4) {
      const depth = TERRAIN.waterLevel - groundAt(wp[i], wp[i + 2])
      colors.set([1, 1, 1, Math.min(1, Math.max(0, depth / (0.6 * S)))], c)
    }
    water.setVerticesData(VertexBuffer.ColorKind, colors)
    water.hasVertexAlpha = true
    const waterMat = material(this.scene, 'water', new Color3(0.16, 0.32, 0.5), 0.6, 0.25)
    waterMat.specularColor = new Color3(0.3, 0.35, 0.4)
    water.material = waterMat
    this.waterMat = waterMat
    const rockMat = material(this.scene, 'rock', new Color3(0.36, 0.35, 0.33), 1, 0.08)
    TERRAIN.rocks.forEach((rock, i) => {
      const m = MeshBuilder.CreateIcoSphere(`rock:${i}`, { radius: 1, subdivisions: 1, flat: true }, this.scene)
      m.scaling.set(rock.r, rock.r * 0.7, rock.r * (0.8 + 0.4 * ((i * 37) % 10) / 10))
      m.rotation.y = i * 1.7
      m.position.set(rock.x, groundAt(rock.x, rock.z), rock.z)
      m.material = rockMat
      m.isPickable = false
      this.rocks.push(m)
    })

    // Trails glow on the ground: warm amber, brighter where more ants have come home that way.
    if (TRAILS_ON) {
      const n = TERRAIN.nav.size
      const overlay = this.terrainMesh('trails', 0.08 * S)
      const tex = new DynamicTexture('trails', { width: n, height: n }, this.scene, false)
      tex.hasAlpha = true
      tex.wrapU = tex.wrapV = 0 // clamp
      const mat = new StandardMaterial('trails', this.scene)
      mat.diffuseColor = BLACK.clone()
      mat.specularColor = BLACK.clone()
      mat.emissiveTexture = tex
      mat.opacityTexture = tex
      mat.disableLighting = true
      mat.backFaceCulling = false
      overlay.material = mat
      this.trailOverlay = overlay
      this.trailTexture = tex
      this.paintTrails()
      window.setInterval(() => this.paintTrails(), 500)
    }

    const ground = this.terrainMesh('nest-level', 0.03 * S)
    ground.isPickable = false
    this.ground = ground
    const grid = new GridMaterial('nest-level-grid', this.scene)
    grid.mainColor = BLACK.clone()
    grid.lineColor = new Color3(0.3, 0.3, 0.28)
    grid.opacity = 0 // lines only: the lit soil underneath carries the colour
    grid.gridRatio = 20 * S
    grid.majorUnitFrequency = 5
    grid.minorUnitVisibility = 0.3
    grid.backFaceCulling = false
    ground.material = grid
    this.grid = grid

    // EXPERIMENTAL frozen ground: a faint icy sheen just above the grid, as strong as the frost.
    if (EXPERIMENT_FROZEN_GROUND) {
      const frost = this.terrainMesh('frost', 0.05 * S)
      const mat = material(this.scene, 'frost', new Color3(0.85, 0.92, 1), 0, 0.6)
      mat.disableLighting = true
      frost.material = mat
      this.frostMat = mat
    }
  }

  /**
   * The colony's foraging territory: a dashed circle on the ground, where food spots appear.
   * Expansion widens it (food is pushed out as the nest digs), so it measures expansion.
   * Built once at radius 1 and scaled, so it can grow smoothly.
   */
  /**
   * The territory boundary as a real barrier: a dashed fence of upright panels standing on
   * the ground. Its SIZE is expansion (it widens as the nest digs out) and its BRIGHTNESS is
   * scouting (see paintPerimeter). Panels are thin instances of one box, laid out on a unit
   * circle under a node scaled by the territory radius (x/z only, so the height stays fixed).
   */
  private createPerimeter(): void {
    const node = new TransformNode('perimeter', this.scene)
    const panel = MeshBuilder.CreateBox('perimeter:fence', { size: 1 }, this.scene)
    panel.isPickable = false
    panel.parent = node
    this.fence = panel
    this.fenceMatrices = new Float32Array(FENCE_PANELS * 16)
    const mat = material(this.scene, 'perimeter:fence', SCOUTING ? TASK_COLOR3.Exploration : new Color3(0.72, 0.7, 0.62), 0.55, 0.6)
    mat.backFaceCulling = false
    panel.material = mat
    this.perimeterMat = mat
    this.perimeter = node
    this.layoutFence(SITE_RADIUS_MAX * this.colony.foodReach)
  }

  /**
   * Stand the fence panels on the terrain around a circle of `radius`: each panel at the
   * ground's height where it stands, 60% panel / 40% gap for the dashed look.
   */
  private layoutFence(radius: number): void {
    this.fenceRadius = radius
    const arc = (Math.PI * 2) / FENCE_PANELS
    const width = arc * radius * 0.6
    for (let i = 0; i < FENCE_PANELS; i++) {
      const a = i * arc
      const x = Math.cos(a) * radius
      const z = Math.sin(a) * radius
      // Box x-axis along the tangent: rotation about Y by −(a + π/2) in Babylon's frame.
      Matrix.Compose(
        new Vector3(width, FENCE_HEIGHT, 0.8 * S),
        Quaternion.RotationAxis(Vector3.Up(), -a - Math.PI / 2),
        new Vector3(x, groundAt(x, z) + FENCE_HEIGHT / 2, z),
      ).copyToArray(this.fenceMatrices, i * 16)
    }
    this.fence.thinInstanceSetBuffer('matrix', this.fenceMatrices, 16)
  }

  private createNest(): void {
    // Dome above ground, sleep chamber below it, joined by a tunnel.
    // Built at the base diameter and scaled every frame, so digging is visible.
    // The anthill: a low mound of excavated soil with a crater and the dark entrance on top,
    // speckled with soil pellets, on a disc of cleared ground (harvester ants clear the ground
    // around their nest). Built at the base size and scaled with digging, like the dome was.
    const rb = NEST_BASE_DIAMETER / 2
    const profile = [
      [1.0, -0.05], [0.98, 0.02], [0.82, 0.12], [0.6, 0.26], [0.4, 0.38], [0.26, 0.44], [0.19, 0.44], [0.15, 0.38], [0.11, 0.32], [0, 0.32],
    ].map(([r, y]) => new Vector3(r * rb, y * rb, 0))
    const nest = MeshBuilder.CreateLathe('nest', { shape: profile, tessellation: 40, sideOrientation: Mesh.DOUBLESIDE }, this.scene)
    // Grainy soil: every vertex a little lighter or darker (deterministic).
    const np = nest.getVerticesData(VertexBuffer.PositionKind)!
    const grain = new Float32Array((np.length / 3) * 4)
    for (let i = 0, c = 0; i < np.length; i += 3, c += 4) {
      const h = Math.abs(Math.sin(np[i] * 12.9898 + np[i + 2] * 78.233 + np[i + 1] * 37.719) * 43758.5453) % 1
      const k = 0.82 + 0.3 * h
      grain.set([k, k, k, 1], c)
    }
    nest.setVerticesData(VertexBuffer.ColorKind, grain)
    this.nest = nest
    nest.material = material(this.scene, 'nest', new Color3(0.55, 0.42, 0.3), 1, 0.25)
    nest.isPickable = false
    const entrance = MeshBuilder.CreateDisc('nest:entrance', { radius: 0.13 * rb, tessellation: 20 }, this.scene)
    entrance.rotation.x = Math.PI / 2
    entrance.position.y = 0.33 * rb
    entrance.material = material(this.scene, 'nest:entrance', new Color3(0.05, 0.035, 0.02), 1, 0)
    entrance.parent = nest
    entrance.isPickable = false
    const pellets = MeshBuilder.CreateIcoSphere('nest:pellets', { radius: 0.035 * rb, subdivisions: 1, flat: true }, this.scene)
    pellets.material = material(this.scene, 'nest:pellets', new Color3(0.62, 0.5, 0.36), 1, 0.2)
    pellets.parent = nest
    pellets.isPickable = false
    const PELLETS = 140
    const pm = new Float32Array(PELLETS * 16)
    const heightAtR = (r: number): number => {
      for (let i = 1; i < profile.length; i++) {
        const a = profile[i - 1]
        const b = profile[i]
        if (r <= a.x && r >= b.x) return a.y + ((b.y - a.y) * (a.x - r)) / (a.x - b.x || 1)
      }
      return 0
    }
    for (let i = 0; i < PELLETS; i++) {
      const ang = i * 2.399963
      const r = rb * (0.22 + 0.76 * Math.sqrt(((i * 0.618034) % 1)))
      const k = 0.6 + 0.8 * ((i * 0.37) % 1)
      Matrix.Compose(new Vector3(k, k * 0.7, k), Quaternion.RotationYawPitchRoll(i, i * 0.3, 0), new Vector3(Math.cos(ang) * r, heightAtR(r), Math.sin(ang) * r)).copyToArray(pm, i * 16)
    }
    pellets.thinInstanceSetBuffer('matrix', pm, 16)
    const clearing = MeshBuilder.CreateDisc('nest:clearing', { radius: rb * NEST_CLEARING, tessellation: 40 }, this.scene)
    clearing.rotation.x = Math.PI / 2
    clearing.position.y = 0.1 * S
    clearing.parent = nest
    clearing.isPickable = false
    const clearMat = material(this.scene, 'nest:clearing', new Color3(0.6, 0.5, 0.38), 0.35, 0.3)
    clearMat.disableLighting = true
    clearing.material = clearMat

    // The tunnel system ants walk: a vertical shaft from the nest down to the sleep chamber, and a
    // horizontal branch from the shaft to each chamber at its own depth.
    const tunnelMat = material(this.scene, 'nest:tunnel', new Color3(0.4, 0.3, 0.2), 1, 0.3)
    const tunnel = bottomPivotCylinder('nest:tunnel', 0.8 * S, this.scene)
    this.interior.push(tunnel)
    span(tunnel, SLEEP_POSITION, Vector3.Zero())
    tunnel.material = tunnelMat
    INTERIOR_TASKS.forEach((task) => {
      const chamber = TASK_POSITIONS[task]
      // The digging front, the store rooms and the nursery are dug rooms: drawn with the network.
      if (task !== 'QueenCare') return
      const branch = bottomPivotCylinder(`nest:tunnel:${task}`, 0.6 * S, this.scene)
      span(branch, new Vector3(0, chamber.y, 0), chamber)
      branch.material = tunnelMat
      this.interior.push(branch)
    })
    // Rooms with their contents (granary, nursery, queen) and the galleries left by digging.
    this.nestView = new NestView(this.scene, this.colony)

    // The sleep chamber: a room shell like every room, in the sleepers' blue.
    const shell = roomShell(this.scene, 'sleep-chamber', SLEEP_POSITION, SLEEP_CHAMBER_RADIUS + 2 * S, 0.8)
    this.sleepChamber = shell.floor
    this.chamberMat = bowlMaterial(this.scene, 'sleep-chamber', SLEEP_TINT, 0.4)
    shell.ceiling.material = this.chamberMat
    shell.floor.material = glassOf(this.chamberMat)
    this.interior.push(shell.floor, shell.ceiling)

    // TRIAL: the nest's real 3D volume is underground: a faint bowl under the dome holding the
    // chambers and the sleep chamber. It widens with expansion, like the fence on the surface.
    if (NEST_BOWL) {
      const bowl = MeshBuilder.CreateSphere('nest:bowl', { diameter: 2, slice: 0.5, segments: 32 }, this.scene)
      bowl.rotation.x = Math.PI // the lower half: a bowl opening up to the surface
      bowl.position.y = SURFACE_Y
      bowl.isPickable = false
      const mat = material(this.scene, 'nest:bowl', new Color3(0.55, 0.42, 0.3), 0.07, 0.2)
      mat.backFaceCulling = false
      bowl.material = mat
      this.bowl = bowl
      // Retired: a see-through volume over the rooms is what made the underground unreadable.
      bowl.setEnabled(false)
    }
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

    const road = this.roadMesh(`site:${task}:road`, pos)
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
    this.updateView()
    this.refresh()
  }

  /** The view the user picked (the controls' Surface / Underground switch). */
  setView(view: NestLayer): void {
    this.viewChoice = view
    this.updateView()
  }

  get view(): NestLayer {
    return this.viewChoice
  }

  /** Called with the view actually shown whenever it changes. */
  onViewChange(listener: (view: NestLayer) => void): void {
    this.viewListeners.push(listener)
    if (this.shown) listener(this.shown)
  }

  /** Underground if chosen, if the camera is below the ground, or an underground task is highlighted. */
  private updateView(): void {
    const below = this.camera.position.y < groundAt(this.camera.position.x, this.camera.position.z)
    const task = this.highlighted
    const want: NestLayer =
      this.viewChoice === 'underground' || below || (task !== null && UNDERGROUND_TASKS.includes(task)) ? 'underground' : 'surface'
    if (want === this.shown) return
    this.shown = want
    this.applyView(want === 'underground')
    this.viewListeners.forEach((l) => l(want))
  }

  private applyView(under: boolean): void {
    this.surfaceFade = under ? 0.15 : 1
    this.soilMat.alpha = under ? 0.1 : 1
    this.waterMat.alpha = under ? 0.08 : 0.6
    this.rocks.forEach((m) => (m.visibility = under ? 0.12 : 1))
    if (this.trailOverlay) this.trailOverlay.visibility = under ? 0.25 : 1
    this.nest.visibility = under ? 0.35 : 1
    this.interior.forEach((m) => m.setEnabled(under))
    this.nestView.setUnderground(under)
    this.scene.clearColor = (under ? UNDERGROUND_SKY : BLACK).toColor4(1)
    this.refresh()
  }

  /** Everything (besides its ants) that belongs to a task: rooms, sites, markers, what is carried. */
  private glowMeshes(task: TaskName): Mesh[] {
    const meshes = (node: TransformNode | Mesh | null | undefined): Mesh[] =>
      !node ? [] : [...(node instanceof Mesh ? [node] : []), ...node.getChildMeshes().filter((m): m is Mesh => m instanceof Mesh)]
    const carried = (t: TaskName): Mesh[] =>
      this.colony.ants.flatMap((a) => {
        const m = a.data.behaviour.actualTask.type === t ? this.carryMeshes.get(a) : undefined
        return m && m.isEnabled() ? [m] : []
      })
    switch (task) {
      case 'Collect':
        return [...this.foodViews.flatMap((v) => meshes(v.root)), ...carried('Collect')]
      case 'Cleaning':
        return [...meshes(this.middenHeap), ...(this.middenBase ? [this.middenBase] : []), ...Object.values(this.debrisMeshes), ...carried('Cleaning')]
      case 'Protection':
        // The kerbs only: the fill is a terrain-sized mesh (mostly transparent) and would glow as a square.
        return this.bandEdges
      case 'Exploration':
        return meshes(this.perimeter)
      case 'Expansion':
        return [...meshes(this.sites.Expansion.root), ...this.nestView.glowMeshes(task)]
      default:
        return this.nestView.glowMeshes(task)
    }
  }

  private paintGlow(): void {
    const task = this.highlighted
    // A different task: start over, so a mesh shared by two tasks takes the new colour.
    if (task !== this.glowTask) {
      this.glowing.forEach((m) => !m.isDisposed() && this.glow.removeMesh(m))
      this.glowing.clear()
      this.glowTask = task
    }
    const want = new Set(task ? this.glowMeshes(task).filter((m) => m.isEnabled() && !m.isDisposed()) : [])
    this.glowing.forEach((m) => {
      if (!want.has(m)) {
        if (!m.isDisposed()) this.glow.removeMesh(m)
        this.glowing.delete(m)
      }
    })
    if (!task) return
    const color = TASK_COLOR3[task]
    want.forEach((m) => {
      if (!this.glowing.has(m)) {
        this.glow.addMesh(m, color)
        this.glowing.add(m)
      }
    })
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
    this.updateView()
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
    const r = this.fenceRadius + (territory - this.fenceRadius) * 0.05
    if (Math.abs(r - this.fenceRadius) > 0.05) this.layoutFence(r)
    if (SCOUTING) this.paintPerimeter()
    // Faint seasonal tint on the ground grid (neutral when seasons are off).
    const [tr, tg, tb] = this.colony.season.tint
    this.grid.lineColor.set(tr, tg, tb)
    // The soil itself follows the season, blending slowly through the year. Solid now (the
    // underground has its own view); toned to how the old half-see-through soil looked over
    // the dark background, without anything below showing through.
    const [gr, gg, gb] = this.colony.season.ground
    this.grid.mainColor.set(gr, gg, gb)
    // Lit soil: brighter than the flat tone, so shading has room to show the relief.
    const lit = 2.4 * SOIL_TONE
    this.soilMat.diffuseColor.set(gr * lit, gg * lit, gb * lit)
    // Pools ice over as the ground freezes (visual; water is still impassable).
    Color3.LerpToRef(WATER, ICE, this.colony.season.frost * 0.8, this.waterMat.diffuseColor)
    if (this.frostMat) this.frostMat.alpha = 0.09 * this.colony.season.frost

    // The underground bowl covers every chamber (deepest: the sleep chamber) and grows with expansion.
    if (this.bowl) {
      const target = BOWL_BASE_RADIUS * (1 + 0.8 * this.colony.expansionLevel)
      const r = this.bowl.scaling.x + (target - this.bowl.scaling.x) * 0.05
      this.bowl.scaling.setAll(r)
    }

    // Underground: rooms and their contents; the digging front (and its tunnel) moves down.
    this.nestView.update()
    const front = TASK_POSITIONS.Expansion
    this.sites.Expansion.root.position.copyFrom(front)
    // (The tunnels to the digging front are the dug network, drawn by the nest view.)

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
      // Size of the spot = size of the find (max 1 = FOOD_SPOT_RADIUS); the seeds on it = what is left.
      const target = (0.55 + 1.45 * size) / 2
      v.scale += (target - v.scale) * 0.12
      v.root.scaling.setAll(v.scale)
      const count = fullness > 0 ? Math.max(1, Math.round(22 * fullness)) : 0
      if (count !== v.seedCount) {
        v.seedCount = count
        v.seeds.setEnabled(count > 0)
        const radius = FOOD_SPOT_RADIUS * (0.3 + 0.4 * fullness)
        if (count > 0) {
          v.seeds.thinInstanceSetBuffer('matrix', pileMatrices(count, radius, radius * 0.18, 1, v.spot.id, 0.35), 16)
          // Each leaf its own shade, from fresh green to yellow.
          const tints = new Float32Array(count * 4)
          for (let i = 0; i < count; i++) {
            const t = ((i * 0.618034 + v.spot.id * 0.21) % 1)
            tints.set([0.55 + 0.4 * t, 0.8 - 0.1 * t, 0.25 + 0.05 * t, 1], i * 4)
          }
          v.seeds.thinInstanceSetBuffer('color', tints, 4)
        }
      }
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
      // EXPERIMENTAL frozen ground: the soil heaps ice over as the ground freezes.
      if (EXPERIMENT_FROZEN_GROUND && task === 'Expansion') {
        const frost = this.colony.season.frost
        Color3.LerpToRef(TASK_COLOR3.Expansion, ICE, frost * 0.75, site.marker.mat.diffuseColor)
        site.marker.mat.emissiveColor.scaleInPlace(1 - 0.4 * frost).addInPlace(ICE.scale(0.25 * frost))
      }
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

    // (The terrain already covers the largest territory expansion can reach: no rescaling.)
  }

  private refresh(): void {
    this.paintGlow()
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
      this.paintCarry(ant)
    })

    // The chamber glows a little brighter the more of the colony is asleep in it.
    // The sleep chamber glows a little more the more of the colony is asleep.
    this.chamberMat.emissiveColor.copyFrom(this.chamberMat.diffuseColor).scaleInPlace(0.25 + 0.5 * Math.sqrt(asleep / total))

    this.refreshFoodSpots(total)
    this.refreshGroundLife()

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
      // With trails the ground shows the real routes, so the straight roads are off.
      site.road.setEnabled(!TRAILS_ON && discovered && !(SCOUTING && task === 'Exploration'))
      const width = ROAD_MIN + (ROAD_MAX - ROAD_MIN) * Math.sqrt(share)
      this.setRoadWidth(site.road, pos3(site.root.position), width)
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
    this.perimeterMat.alpha = (starving ? base * (0.5 + 0.5 * pulse) : base) * (dim ? 0.25 : 1) * this.surfaceFade
    this.perimeterMat.emissiveColor.copyFrom(TASK_COLOR3.Exploration).scaleInPlace(lit ? 0.9 : 0.6)
  }

  /** Redraw the trail overlay from the trail field (one pixel per route-grid cell). */
  private paintTrails(): void {
    const tex = this.trailTexture
    if (!tex) return
    const n = TERRAIN.nav.size
    const ctx = tex.getContext() as CanvasRenderingContext2D
    const img = ctx.createImageData(n, n)
    // Normalise against a high but not extreme level, so one busy cell doesn't wash out the rest.
    const ref = Math.max(8, TRAILS.peak * 0.35)
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const v = Math.min(1, Math.sqrt(TRAILS.strength[j * n + i] / ref))
        // "No entry" marks read the opposite way to trails (avoid, not follow), so they get the
        // opposite colour: cold cyan against the warm amber of the routes that work.
        const x = NO_ENTRY_ON ? Math.min(1, TRAILS.noEntry[j * n + i] / 2) : 0
        // Texture rows run top-down while cells run from −z: flip rows so the glow sits under the walkers.
        const o = ((n - 1 - j) * n + i) * 4
        const k = x > 0 ? x / (x + v + 1e-6) : 0 // share of the colour that is "no entry"
        img.data[o] = Math.round(255 * (1 - k) + 70 * k)
        img.data[o + 1] = Math.round(205 * (1 - k) + 215 * k)
        img.data[o + 2] = Math.round(120 * (1 - k) + 255 * k)
        img.data[o + 3] = Math.round(220 * Math.max(v, x))
      }
    }
    ctx.putImageData(img, 0, 0)
    tex.update()
  }

  // --- roads: draped over the terrain ------------------------------------------

  /** 24 points from the nest to `to`: over the ground, or a straight tunnel if `to` is underground. */
  private roadPath(to: Vector3): Vector3[] {
    const underground = isUnderground(to)
    if (underground) {
      return Array.from({ length: ROAD_POINTS }, (_, i) => to.scale(i / (ROAD_POINTS - 1)))
    }
    // The real route: the nest's route map, reversed (nest → site), around water and rock.
    const home = TERRAIN.routeToNest(to.x, to.z)
    const way = home.length > 0 ? [{ x: 0, z: 0 }, ...home.slice(0, -1).reverse(), { x: to.x, z: to.z }] : [{ x: 0, z: 0 }, { x: to.x, z: to.z }]
    // Resample to a fixed point count (tubes are updated in place, which needs the same count).
    const cum = [0]
    for (let i = 1; i < way.length; i++) cum.push(cum[i - 1] + Math.hypot(way[i].x - way[i - 1].x, way[i].z - way[i - 1].z))
    const total = cum[cum.length - 1] || 1
    let k = 0
    return Array.from({ length: ROAD_POINTS }, (_, i) => {
      const d = (i / (ROAD_POINTS - 1)) * total
      while (k < way.length - 2 && cum[k + 1] < d) k++
      const span = cum[k + 1] - cum[k] || 1
      const t = Math.min(1, Math.max(0, (d - cum[k]) / span))
      const x = way[k].x + (way[k + 1].x - way[k].x) * t
      const z = way[k].z + (way[k + 1].z - way[k].z) * t
      return new Vector3(x, groundAt(x, z) + 0.3 * S, z)
    })
  }

  private roadMesh(name: string, to: Vector3): Mesh {
    const road = MeshBuilder.CreateTube(
      name,
      { path: this.roadPath(to), radius: ROAD_MIN / 2, tessellation: 6, updatable: true },
      this.scene,
    )
    road.isPickable = false
    return road
  }

  /** Re-shape a road in place (same point count): new end point and/or width. */
  private setRoadWidth(road: Mesh, to: Vector3, width: number): void {
    MeshBuilder.CreateTube(road.name, { path: this.roadPath(to), radius: width / 2, instance: road })
  }

  // --- life on the ground: patrol band, debris, carried items ---------------------

  private createGroundLife(): void {
    this.bandMat = material(this.scene, 'patrol-band', TASK_COLOR3.Protection, 0.12, 0.5)
    this.bandMat.backFaceCulling = false
    this.bandMat.disableLighting = true
    this.bandEdgeMat = material(this.scene, 'patrol-band:edge', TASK_COLOR3.Protection, 0.8, 0.8)
    this.bandEdgeMat.disableLighting = true
    this.bandEdgeMat.backFaceCulling = false
    const kinds: [('spoil' | 'scrap' | 'corpse'), Color3, number][] = [
      ['spoil', new Color3(0.45, 0.33, 0.22), 1.3],
      ['scrap', new Color3(0.78, 0.62, 0.34), 0.9],
      ['corpse', new Color3(0.15, 0.13, 0.12), 1.1],
    ]
    kinds.forEach(([kind, color, size]) => {
      const m = MeshBuilder.CreateIcoSphere(`debris:${kind}`, { radius: 0.6 * size * S, subdivisions: 1, flat: true }, this.scene)
      m.material = material(this.scene, `debris:${kind}`, color, 1, 0.2)
      m.isPickable = false
      m.setEnabled(false)
      this.debrisMeshes[kind] = m
    })
    // The midden: a ring in the Cleaning colour, and inside it a real refuse heap (spoil, husks
    // and dead nestmates, the same pieces cleaners carry) that grows with what is dumped and
    // shrinks as it rots.
    const midden = TASK_POSITIONS.Cleaning
    const middenBase = (this.middenBase = groundRing(this.scene, 'midden:ring', MIDDEN_RADIUS * 0.9, TASK_COLOR3.Cleaning))
    middenBase.position.addInPlace(midden)
    const heap = new Mesh('midden:heap', this.scene)
    heap.position.copyFrom(midden)
    this.middenHeap = heap
    kinds.forEach(([kind]) => {
      const piece = this.debrisMeshes[kind].clone(`midden:${kind}`)
      piece.setEnabled(true)
      piece.parent = heap
      piece.position.setAll(0)
      this.middenPieces[kind] = piece
    })
    this.seedMat = material(this.scene, 'carry:seed', new Color3(0.62, 0.78, 0.3), 1, 0.4)
    this.leafMat = material(this.scene, 'food:leaf', new Color3(1, 1, 1), 1, 0.15)
    this.leafMat.backFaceCulling = false
    this.pebbleMat = material(this.scene, 'carry:pebble', new Color3(0.4, 0.32, 0.24), 1, 0.2)
  }

  /** The patrol band: a ring on the ground from PATROL_BAND.inner to .outer, draped on the terrain. */
  private layoutBand(): void {
    const outer = PATROL_BAND.outer
    if (Math.abs(outer - this.bandOuter) < 1 && this.band) return
    this.bandOuter = outer
    const inner = PATROL_BAND.inner
    // The fill IS the terrain (a copy lifted a hair above it), so it follows every bump; only
    // the annulus is visible, through vertex alpha with soft edges. (A ribbon across the band
    // cut straight through the hills between its few rings.)
    if (!this.band) {
      const band = this.terrainMesh('patrol-band', 0.12 * S)
      band.material = this.bandMat
      band.hasVertexAlpha = true
      this.band = band
    }
    const pos = this.band.getVerticesData(VertexBuffer.PositionKind)!
    const colors = new Float32Array((pos.length / 3) * 4)
    const soft = 1.5 * S
    for (let i = 0, c = 0; i < pos.length; i += 3, c += 4) {
      const r = Math.hypot(pos[i], pos[i + 2])
      const inside = Math.min(r - inner, outer - r) / soft
      colors.set([1, 1, 1, Math.max(0, Math.min(1, inside))], c)
    }
    this.band.setVerticesData(VertexBuffer.ColorKind, colors)

    // Its two edges are low kerbs standing on the ground: a little 3D height, but lower than an
    // ant (workers are 1 unit), so they never hide the patrollers.
    const SEG = 192
    const ring = (r: number, dy: number): Vector3[] =>
      Array.from({ length: SEG + 1 }, (_, i) => {
        const a = (i / SEG) * Math.PI * 2
        const x = Math.cos(a) * r
        const z = Math.sin(a) * r
        return new Vector3(x, groundAt(x, z) + dy, z)
      })
    this.bandEdges.forEach((m) => m.dispose())
    this.bandEdges = [inner, outer].map((r, i) => {
      const edge = MeshBuilder.CreateRibbon(
        `patrol-band:edge:${i}`,
        { pathArray: [ring(r, -0.3 * S), ring(r, BAND_KERB_HEIGHT)], sideOrientation: Mesh.DOUBLESIDE },
        this.scene,
      )
      edge.material = this.bandEdgeMat
      edge.isPickable = false
      return edge
    })
  }

  private refreshGroundLife(): void {
    this.layoutBand()
    // Midden heap: grows with the refuse dumped on it (and shrinks as it rots).
    if (this.middenHeap) {
      // Refuse pieces: more with more refuse, the heap wider and taller with them.
      const count = Math.min(90, Math.round(3 + Math.sqrt(this.colony.midden) * 6))
      if (count !== this.middenCount) {
        this.middenCount = count
        const share = { spoil: 0.55, scrap: 0.3, corpse: 0.15 }
        const radius = MIDDEN_RADIUS * (0.35 + 0.45 * Math.min(1, count / 90))
        ;(Object.keys(share) as ('spoil' | 'scrap' | 'corpse')[]).forEach((kind, j) => {
          const n = Math.max(kind === 'corpse' ? 0 : 1, Math.round(count * share[kind]))
          this.middenPieces[kind].thinInstanceSetBuffer('matrix', pileMatrices(n, radius, radius * 0.45, 1, j * 17), 16)
        })
      }
      const dim = this.highlighted !== null && this.highlighted !== 'Cleaning'
      Object.values(this.middenPieces).forEach((m) => (m.visibility = (dim ? 0.2 : 1) * this.surfaceFade))
      if (this.middenBase) this.middenBase.visibility = (dim ? 0.2 : 1) * this.surfaceFade
    }
    // Band brightness = how well protection keeps up (actual ÷ need), like every gauge.
    const { need, actual } = this.colony.needs.Protection
    const supply = need > 0 ? Math.min(MAX_LEVEL, actual / need) : MAX_LEVEL
    const dim = this.highlighted !== null && this.highlighted !== 'Protection'
    const level = supply / MAX_LEVEL
    const lit = this.highlighted === 'Protection' ? 1.5 : 1
    this.bandMat.alpha = (0.1 + 0.22 * level) * (dim ? 0.3 : 1) * lit * this.surfaceFade
    // Its edges: crisp lines that say where the protected area starts and ends.
    this.bandEdgeMat.alpha = Math.min(1, (0.45 + 0.45 * level) * (dim ? 0.3 : 1) * lit) * this.surfaceFade
    Object.values(this.debrisMeshes).forEach((m) => (m.visibility = this.surfaceFade))

    // Debris: thin instances per kind, redrawn when the set changes.
    const sig = DEBRIS.length * 7 + DEBRIS.filter((d) => d.kind === 'corpse').length
    if (sig !== this.debrisSeen) {
      this.debrisSeen = sig
      ;(Object.keys(this.debrisMeshes) as ('spoil' | 'scrap' | 'corpse')[]).forEach((kind) => {
        const items = DEBRIS.filter((d) => d.kind === kind)
        const mesh = this.debrisMeshes[kind]
        if (items.length === 0) {
          mesh.setEnabled(false)
          return
        }
        mesh.setEnabled(true)
        const m = new Float32Array(items.length * 16)
        items.forEach((d, i) => {
          Matrix.Translation(d.x, groundAt(d.x, d.z) + 0.3 * S, d.z).copyToArray(m, i * 16)
        })
        mesh.thinInstanceSetBuffer('matrix', m, 16)
      })
    }
  }

  /** A seed on a forager bringing food home, a pebble on a cleaner carrying debris. */
  private paintCarry(ant: Ant): void {
    const carrying = ant.carried > 0 ? this.seedMat : ant.carryingDebris ? this.pebbleMat : null
    let mesh = this.carryMeshes.get(ant)
    if (!carrying) {
      mesh?.setEnabled(false)
      return
    }
    if (!mesh) {
      mesh = MeshBuilder.CreateSphere('carry', { diameter: 0.9 * S, segments: 6 }, this.scene)
      mesh.parent = ant.data.body as Mesh
      mesh.position.y = 0.55 * S
      mesh.isPickable = false
      this.carryMeshes.set(ant, mesh)
    }
    mesh.material = carrying
    // A piece of leaf (flat, green) coming home with food; a pebble of debris otherwise.
    if (carrying === this.seedMat) mesh.scaling.set(1.7, 0.3, 1)
    else mesh.scaling.setAll(1)
    mesh.setEnabled(true)
  }

  // --- food spots ------------------------------------------------------------

  private createFoodSpotView(spot: FoodSpot): FoodSpotView {
    const scene = this.scene
    const color = TASK_COLOR3.Collect
    const root = new TransformNode(`food:${spot.id}`, scene)
    root.position.copyFrom(spot.position)

    // A food spot is a group of fallen leaves inside a ring in the Collect colour. Built at
    // full size (FOOD_SPOT_RADIUS) and scaled by how big the find is; fewer leaves are left as
    // ants carry them off.
    const ring = groundRing(scene, `food:${spot.id}:ring`, FOOD_SPOT_RADIUS * 0.9, color)
    ring.parent = root
    const patch = MeshBuilder.CreateDisc(`food:${spot.id}:patch`, { radius: FOOD_SPOT_RADIUS * 0.9, tessellation: 32 }, scene)
    patch.rotation.x = Math.PI / 2
    patch.position.y = 0.15 * S
    patch.parent = root
    patch.material = material(scene, `food:${spot.id}:patch`, color, 0.18, 0.4)
    patch.isPickable = true
    patch.actionManager = new ActionManager(scene)
    patch.actionManager.registerAction(
      new ExecuteCodeAction(ActionManager.OnPickTrigger, () => this.focus(spot.position.clone(), FOCUS_RADIUS)),
    )
    const seeds = leafMesh(scene, `food:${spot.id}:leaves`, 5 * S)
    seeds.parent = root
    seeds.material = this.leafMat

    const road = this.roadMesh(`food:${spot.id}:road`, spot.position)
    const roadMat = material(scene, `food:${spot.id}:road`, color, 0.2, 0.6)
    road.material = roadMat
    return { spot, epoch: spot.epoch, root, road, roadMat, scale: 0.01, seeds, seedCount: -1 }
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
        this.setRoadWidth(view.road, spot.position, ROAD_MIN)
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
      const fade = (dim ? 0.15 : 1) * (known ? 1 : 0.3) * this.surfaceFade
      v.root.getChildMeshes().forEach((m) => (m.visibility = fade))
      v.road.setEnabled(!TRAILS_ON && known)
      const width = ROAD_MIN + (ROAD_MAX - ROAD_MIN) * Math.sqrt(share)
      this.setRoadWidth(v.road, v.spot.position, width)
      v.roadMat.alpha = (0.12 + 0.6 * Math.sqrt(share)) * (dim ? 0.15 : 1)
    })
  }

  private paintAnt(ant: Ant, task: TaskName): void {
    const mesh = ant.data.body as AbstractMesh | null
    const mat = mesh?.material as StandardMaterial | null
    if (!mesh || !mat) return
    // Colour = task. Like real callow workers, a new ant starts PALE and darkens to its full
    // colour as it matures. Brightness = how much of the map it truly knows (sites, and a food
    // spot that still has food): a dim ant knows little, a bright one knows a lot.
    const age = (simNow() - ant.data.bornAt) / CALLOW_MS
    const pale = Math.max(0, 1 - age) * 0.7
    Color3.LerpToRef(TASK_COLOR3[task], CALLOW, pale, mat.diffuseColor)
    if (ant.isSleeping) {
      // Asleep: unlit and half transparent.
      mat.emissiveColor.copyFrom(BLACK)
    } else {
      mat.emissiveColor.copyFrom(mat.diffuseColor).scaleInPlace(0.12 + 0.6 * ant.knowledgeShare())
    }
    const visible = this.highlighted === null || this.highlighted === task
    // Each view shows its own ants: underground ones only underground, surface ones faint there.
    const below = isUnderground(mesh.position)
    const layer = this.shown === 'underground' ? (below ? 1 : 0.2) : below ? 0 : 1
    mesh.visibility = (visible ? 1 : 0.08) * (ant.isSleeping ? 0.7 : 1) * layer
  }

  private focus(target: Vector3, radius: number): void {
    this.camera.setTarget(target.clone())
    this.camera.radius = radius
  }
}
