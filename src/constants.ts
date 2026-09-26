import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { v1 as uuidv1 } from 'uuid'

import { simNow } from './commons/simClock'
import { createTerrain } from './model/terrain'
import { Trails } from './model/trails'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AntType = 'P' | 'W'

export type TaskName =
  | 'Protection'
  | 'Exploration'
  | 'QueenCare'
  | 'EggLarvePupeaCare'
  | 'Collect'
  | 'Store'
  | 'Expansion'
  | 'Cleaning'

export type RankTasks = Partial<Record<TaskName, number>>
export type GeneticalPriority = Record<TaskName, number>
export type DiscoveredPositions = Record<TaskName, boolean>

export interface ActualTask {
  type: TaskName
  interactionPercentage: number
  lastInteraction: number
}

export interface AntBehaviour {
  actualTask: ActualTask
  rankTasks: RankTasks
  discoveredPositions: DiscoveredPositions
  geneticalPriority: GeneticalPriority
}

export interface NestNeed {
  urgency: number
  actual: number
  need: number
  min_dedicated_ants: number
  dedicated_ants: number
}

export type NestNeeds = Record<TaskName, NestNeed>

export type NestCallback = (id: string, actualTask: ActualTask, previousTask: TaskName, addedValue: number) => void
export type ReproductionCallback = (id: string) => void
export type DisposeCallback = (id: string) => void

export interface AntData {
  id: string
  type: AntType
  size: 'big' | 'small'
  bornAt: number
  generation: number // 1 = founding colony, child = parent + 1
  cloned: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  animation: any
  awakeTime: number | null
  reproductionOn: boolean
  sleeping: boolean
  reproductionTime: number
  lifeTime: number
  totalAntsInNest: number
  behaviour: AntBehaviour
  // populated by the Ant class once Babylon objects exist
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  babylonElements: any
  target?: Vector3
  nest?: Vector3
  nestNeeds?: NestNeeds
  nestCallback?: NestCallback
  reproductionCallback?: () => void
  disposeCallback?: () => void
}

// ---------------------------------------------------------------------------
// Tunable constants (preserved verbatim from the 2021 model)
// ---------------------------------------------------------------------------

// World size. Used to be MAX_ANTS, which also sized the world, the ants and the camera;
// now that population is dynamic, the two are separate.
export const WORLD_SCALE = 2e2
/**
 * Every 3D size (sites, markers, nest, roads, effects, camera distances) was drawn for a
 * world of 300. Multiply by this so symbols keep their proportion to the world when
 * WORLD_SCALE changes. Ants already scale with WORLD_SCALE directly.
 */
export const REFERENCE_WORLD_SCALE = 3e2
export const SYMBOL_SCALE = WORLD_SCALE / REFERENCE_WORLD_SCALE
export const INITIAL_ANTS = Math.round(WORLD_SCALE / 2.5)
// Hard performance ceiling only; the real limit is food (see Colony economy below).
export const POPULATION_CAP = 500
export const INCREASE_MAIN_TASK = 0.55
export const NEG_TARGET_MATCH = -0.5
export const POS_TARGET_MATCH = 0.5
// Discovery used to be tested only where a leg ENDED (the random target), so a site was
// found only if a target happened to land within ±20 of it. On the way the ant was blind.
// With DISCOVER_ALONG_PATH it notices its task's site whenever it passes within the same
// window, so a leg sweeps a corridor instead of testing one point.
export const DISCOVER_ALONG_PATH = true
/**
 * Exploration is the scouting job: scouts roam random points in the territory, notice every
 * site and food spot they pass, and pass the news on to the ants who need it. Without it,
 * nobody's job was to find things: every ant that didn't know its own site searched blind.
 */
export const SCOUTING = true
export const NEG_DISCOVERED_TARGET_MATCH = -20
export const POS_DISCOVERED_TARGET_MATCH = 20
export const SEARCHING_RADIUS = WORLD_SCALE / 10
export const AUTODISCOVERING = true
export const REPRODUCTION_ON = true
export const ANT_INFLUENCE_FACTOR = Math.random() / 1e6
export const MIN_CHECK_TIME_INTERVAL = 30e3
export const CHECK_TIME_INTERVAL = Math.random() * (90e3 - MIN_CHECK_TIME_INTERVAL) + MIN_CHECK_TIME_INTERVAL

export const TASKS: Record<AntType, TaskName[]> = {
  P: ['Protection', 'Store', 'Cleaning', 'Expansion', 'Exploration', 'QueenCare', 'EggLarvePupeaCare'],
  W: ['Collect', 'Store', 'Cleaning', 'Expansion', 'Exploration', 'QueenCare', 'EggLarvePupeaCare'],
}

/** Farthest a site is placed from the nest on each axis, before expansion widens it. */
export const SITE_RADIUS_MAX = SEARCHING_RADIUS * (Math.PI * 1.35)

// ---------------------------------------------------------------------------
// Terrain and walking (routes, phase 1)
// ---------------------------------------------------------------------------
// The ground is a generated landscape, not a plane: rolling hills and hollows, level around
// the nest. It covers the largest territory expansion can reach (×2.6) with margin.
/** How much climbing slows an ant: speed ÷ (1 + SLOPE_COST × uphill grade). Also the route cost. */
export const SLOPE_COST = 1.5

// Phase 2 of routes: obstacles. Water fills the lowest hollows (WATER_SHARE of the land) and
// rock outcrops are scattered in the territory; neither can be walked through, so the
// straight line often isn't possible and ants follow routes around them. Both are kept
// clear of the nest area (chambers, guard post).
export const WATER_SHARE = 0.08
export const ROCK_COUNT = 14

export const TERRAIN = createTerrain({
  half: SITE_RADIUS_MAX * 3,
  size: 160,
  amplitude: SITE_RADIUS_MAX * 0.25,
  wavelength: SITE_RADIUS_MAX * 0.9,
  flatRadius: SEARCHING_RADIUS * 1.2,
  flatRamp: SEARCHING_RADIUS * 1.2,
  waterShare: WATER_SHARE,
  rockCount: ROCK_COUNT,
  rockRadius: [SEARCHING_RADIUS * 0.25, SEARCHING_RADIUS * 0.6],
  clearRadius: SEARCHING_RADIUS * 2,
  rockReach: SITE_RADIUS_MAX * 2.6,
  slopeCost: SLOPE_COST,
  navSize: 96,
})
/** Ground height at (x, z). */
export const groundAt = (x: number, z: number): number => TERRAIN.heightAt(x, z)

/**
 * Is this point underground (in the nest's tunnels and chambers)? Measured against the ground
 * AT THAT SPOT. An absolute "below −1" test dated from the flat world: on terrain, a food spot
 * or search point in a hollow counted as underground, so ants walked a straight "tunnel"
 * through the ground to it, across pools and all.
 */
export const isUnderground = (v: { x: number; y: number; z: number }): boolean => v.y < groundAt(v.x, v.z) - 1

// ---------------------------------------------------------------------------
// Trails (routes, phase 3)
// ---------------------------------------------------------------------------
// Routes are no longer planned: ants walk cell by cell and choose each step, weighing the
// trail in the next cell against how much it brings them towards their goal (they know the
// DIRECTION of their goal and of home, like real ants, not the way around obstacles). They
// lay trail as they walk: strongly when coming home successful (food, or work done at a
// site), faintly otherwise. Trails fade. Routes that work get walked more and grow; detours
// fade. The colony's routes live in the ground.
export const TRAILS_ON = true
export const TRAILS = new Trails(TERRAIN)
/** "No entry" marks where ants got stuck (see Trails.noEntry): on/off, half-life, strength of avoidance. */
export const NO_ENTRY_ON = true
export const NO_ENTRY_HALF_LIFE_MS = 180e3
export const NO_ENTRY_AVOID = 3
/** Within this distance of its goal an ant neither lays nor heeds no-entry marks. */
export const NO_ENTRY_GOAL_CLEAR = SEARCHING_RADIUS * 1.2
/** Trail fades by half in this much sim time. */
export const TRAIL_HALF_LIFE_MS = 3 * 60e3
/** Trail laid per world unit walked: coming home successful, and everyone else. */
export const TRAIL_DEPOSIT_SUCCESS = 1
export const TRAIL_DEPOSIT_FAINT = 0.1
/** Step choice: weight = ((τ + τ0) / τ0)^α × (goal progress)^β. */
export const TRAIL_TAU0 = 1
export const TRAIL_ALPHA = 1
export const TRAIL_GOAL_BETA = 12
/** Stepping straight back where you came from is discouraged. */
export const TRAIL_BACKTRACK_PENALTY = 0.1
/** Steps without getting closer before the safety valve (a planned route) kicks in. */
export const TRAIL_STUCK_STEPS = 35

// Ants now WALK at a speed over the ground instead of playing a straight-line animation of
// fixed length. Trip time follows distance and slope. The base speed keeps the average leg
// close to the old animations (8–25 s), so the colony's balance carries over.
/** Walking speed on level ground, world units per sim second (per-ant ±20%). */
export const WALK_SPEED = 7 * (WORLD_SCALE / 300)

const getRandomPos = (): number =>
  Math.random() * (SITE_RADIUS_MAX - SEARCHING_RADIUS / 2) + SEARCHING_RADIUS / 2

// Was out in the field at (-2π·R, π·R, 0); ants sleep inside the nest, so it now sits right under it.
export const SLEEP_POSITION = new Vector3(0, -SEARCHING_RADIUS * 1.5, 0)

// --- site placement --------------------------------------------------------
// Each site gets a signed octant so the eight of them spread around the nest, but the
// three axes were drawn independently, so two sites sharing an octant (Store, Exploration
// and QueenCare all sit at (-,+,-)) could land on top of each other. Sites are physical
// things with a footprint, so placement now keeps them a minimum distance apart.
//
// The distance is expressed as a MULTIPLE OF THE FOOTPRINT rather than a world number, so
// it stays correct if the site geometry is resized: two sites are never closer than
// SITE_FOOTPRINT × SITE_SEPARATION_RATIO, centre to centre.
export const SITE_FOOTPRINT = 12 * SYMBOL_SCALE // matches BASE_DIAMETER in the view
export const SITE_SEPARATION_RATIO = 2.5
export const MIN_SITE_DISTANCE = SITE_FOOTPRINT * SITE_SEPARATION_RATIO
const PLACEMENT_ATTEMPTS = 60
/** Largest drawn radius of a food spot (its patch at full size), and of the midden. */
export const FOOD_SPOT_RADIUS = 12 * SYMBOL_SCALE
export const MIDDEN_RADIUS = 7 * SYMBOL_SCALE

/**
 * Is a disc of radius `r` at (x, z) clear of the environment? Every point of it on dry,
 * walkable ground, and clear of every rock AS DRAWN (the outcrops are drawn up to ~1.2× their
 * walking radius). What stands on the ground (food, the midden, exits, debris) is placed only
 * where this holds, so nothing sits in a pool or half inside a rock.
 */
export const clearGround = (x: number, z: number, r: number): boolean => {
  if (!TERRAIN.passable(x, z)) return false
  for (let k = 0; k < 8; k++) {
    const px = x + Math.cos((k * Math.PI) / 4) * r
    const pz = z + Math.sin((k * Math.PI) / 4) * r
    if (!TERRAIN.passable(px, pz) || TERRAIN.heightAt(px, pz) < TERRAIN.waterLevel + 0.3) return false
  }
  return TERRAIN.rocks.every((q) => Math.hypot(q.x - x, q.z - z) >= q.r * 1.25 + r)
}

/** Signed octant per task: keeps the original spread, now only as a direction. */
const SITE_OCTANT: Record<TaskName, [number, number, number]> = {
  Store: [-1, 1, -1],
  Exploration: [-1, 1, -1],
  Collect: [1, -1, 1],
  Protection: [1, -1, 1],
  Expansion: [-1, -1, 1],
  Cleaning: [1, 1, -1],
  QueenCare: [-1, 1, -1],
  EggLarvePupeaCare: [1, -1, 1],
}

const farEnough = (candidate: Vector3, taken: Vector3[], min: number): boolean =>
  taken.every((p) => Vector3.Distance(candidate, p) >= min)

/**
 * Draw a position in the task's octant that clears every already-placed site.
 *
 * Rejection sampling with a bounded attempt count: with eight sites in a world this size
 * it succeeds almost immediately, but a caller can ask for a spacing the world cannot
 * satisfy. Rather than loop forever it keeps the roomiest candidate it saw, so placement
 * always terminates and degrades to "as far apart as we could manage".
 */
export const placeSite = (task: TaskName, taken: Vector3[], scale = 1): Vector3 =>
  placeInOctant(SITE_OCTANT[task], taken, scale)

/** Same rejection sampling as placeSite, for an explicit octant (food spots pick theirs at random). */
export const placeInOctant = (
  [sx, sy, sz]: [number, number, number],
  taken: Vector3[],
  scale = 1,
): Vector3 => {
  let best = Vector3.Zero()
  let bestClearance = -1

  for (let i = 0; i < PLACEMENT_ATTEMPTS; i++) {
    const candidate = new Vector3(sx * getRandomPos() * scale, sy * getRandomPos() * scale, sz * getRandomPos() * scale)
    if (farEnough(candidate, taken, MIN_SITE_DISTANCE)) return candidate
    const clearance = taken.length === 0 ? Infinity : Math.min(...taken.map((p) => Vector3.Distance(candidate, p)))
    if (clearance > bestClearance) {
      bestClearance = clearance
      best = candidate
    }
  }
  return best
}

// --- where each job happens ---------------------------------------------------
// Sites used to float at random heights (±~127). Now the world has a ground (y = 0) and
// jobs sit where they happen in a real nest:
//   surface (y = 0): food spots, the guard post (Protection), the midden (Cleaning);
//   underground, around the tunnel under the dome: the queen's (founding) chamber, the
//   first nursery (brood) and store rooms, and the digging front (expansion) just under the
//   surface at the nest's edge, which is where frozen ground bites. The sleep chamber is
//   deepest. The nursery and store positions follow the rooms that hold the most brood/food.
// Interior sites are known from birth: workers emerge inside the nest.
export const SURFACE_Y = 0
export const INTERIOR_TASKS: TaskName[] = ['QueenCare', 'EggLarvePupeaCare', 'Store', 'Expansion']
/**
 * VISUAL ONLY: the nest is drawn growing downward as it expands (galleries under the nest,
 * depth in SEARCHING_RADIUS units). The digging front ants walk to stays where it is.
 */
/**
 * Expansion digs a RANDOM tunnel network inside the territory. Every DIG_WORK_PER_TUNNEL of
 * digging work, a new tunnel grows from a random point of the network (the shaft or any earlier
 * tunnel), in a random direction and over a random length, staying underground, inside the
 * territory and clear of the chambers. The digging front is always the newest tip, and diggers
 * walk the network (down the shaft, along the branches) to reach it.
 */
export const DIG_WORK_PER_TUNNEL = 40
/** The network stops growing here (a full nest keeps working its existing tunnels). */
export const DIG_NETWORK_MAX = 80
export const DIG_TUNNEL_LENGTH: [number, number] = [SEARCHING_RADIUS * 0.35, SEARCHING_RADIUS * 0.8]
/**
 * Real nests are mostly vertical (casts of harvester and fire ant nests): shafts wander
 * downward, and flat chambers branch off them at depth. So a new tunnel is either a SHAFT
 * (mostly down, a little sideways, ending in a small junction) or a GALLERY (roughly level,
 * ending in a chamber). The nest may go this deep.
 */
export const DIG_SHAFT_SHARE = 0.35
export const DIG_SHAFT_DROP: [number, number] = [SEARCHING_RADIUS * 0.35, SEARCHING_RADIUS * 0.8]
export const DIG_MAX_DEPTH = SEARCHING_RADIUS * 2.8
/** Digging deeper gets harder: a place this deep counts 1/e as much when choosing where to dig. */
export const DIG_DEPTH_SCALE = SEARCHING_RADIUS * 3
/** Vertical distance counts this many times horizontal when looking for open ground to dig. */
export const DIG_VERTICAL_ROOM = 2.5
/** How far a tunnel wanders off the straight line, as a share of its length. */
export const DIG_WANDER = 0.12
/** Bends along each tunnel (sideways only, see digNewTunnel): a gentle arc, not a maze. */
export const DIG_BENDS = 1
/** Points per bend when the tunnel is smoothed into a curve. */
export const DIG_CURVE_STEPS = 6
export interface DigNode {
  pos: Vector3
  /** Radius of the chamber dug at this tip (0 for the shaft root). */
  room: number
  /** Index of the node this tunnel grew from; −1 for the root on the shaft. */
  parent: number
  /** Bends along the tunnel from the parent to here (tunnels are dug wandering, not straight). */
  via: Vector3[]
  /** What the chamber is used for, one role per room; null while it is free. */
  role: RoomRole | null
  /** Ants asleep in it (role 'sleep'). */
  sleepers: number
  /** Brood items or food units kept in it (roles 'brood' / 'store'). */
  fill: number
}
/** Live network, owned by the Colony; ants and the view read it. Node 0 is on the shaft. */
export const DIG_NETWORK: DigNode[] = []

/**
 * Dug chambers take over work from the built rooms when those get full: ants sleep in them,
 * brood is moved into them, food is stored in them. One role per room, never mixed; what a
 * room holds depends on its size. The colony assigns free rooms (the one nearest the main room
 * of that role) when there is overflow, and frees them again when empty and no longer needed.
 */
export type RoomRole = 'sleep' | 'brood' | 'store'
/** What one standard room (the size of the built nursery, radius 0.32R) holds. */
export const ROOM_UNIT_HOLDS: Record<RoomRole, number> = { sleep: 30, brood: 60, store: 2500 }
const ROOM_UNIT_RADIUS = SEARCHING_RADIUS * 0.32
/** A dug chamber (squashed to 0.6 of its height) in standard-room units. */
export const roomUnits = (radius: number): number => (0.6 * radius ** 3) / ROOM_UNIT_RADIUS ** 3
export const roomCapacity = (node: DigNode, role: RoomRole): number => ROOM_UNIT_HOLDS[role] * roomUnits(node.room)
/**
 * The founding chamber: the queen's own, the one room a nest starts with. It holds a little
 * brood and a little food; every other store and nursery is a dug room. `brood` / `store` are
 * what it holds right now (set by the colony).
 */
export const FOUNDING_HOLDS: Record<RoomRole, number> = { sleep: 0, brood: 15, store: 300 }
export const FOUNDING = { brood: 0, store: 0 }
/** The colony starts as a going concern: a store room and a nursery are already dug. */
export const START_ROOM_RADIUS: Record<'brood' | 'store', number> = { store: SEARCHING_RADIUS * 0.4, brood: SEARCHING_RADIUS * 0.34 }
/**
 * What doesn't fit. Food with no store room to go in lies in the tunnels and spoils fast
 * (share per minute, Store work doesn't help); brood with no nursery room is crowded in and
 * gets only this share of the care.
 */
export const UNSTORED_SPOIL_PER_MIN = 0.05
export const UNHOUSED_BROOD_CARE = 0.3
/**
 * Digging follows crowding: the need to dig rises with the share of food, brood and sleepers
 * that has no room (0..1 each, summed), per minute.
 */
export const EXPANSION_CROWDING_NEED_PER_MIN = 8
/** Ants asleep in the main sleep chamber under the nest (which holds one standard room's worth). */
export const MAIN_SLEEP = { sleepers: 0 }

/**
 * Where an ant falling asleep lies down: the main chamber while it has room, else the nearest
 * dug sleeping room with space, else the main chamber anyway (crowded). −1 = main chamber.
 */
export const pickSleepRoom = (at: Vector3): number => {
  if (MAIN_SLEEP.sleepers < ROOM_UNIT_HOLDS.sleep) return -1
  let best = -1
  let bestD = Infinity
  DIG_NETWORK.forEach((n, i) => {
    if (n.role !== 'sleep' || n.sleepers >= roomCapacity(n, 'sleep')) return
    const d = Vector3.Distance(n.pos, at)
    if (d < bestD) {
      bestD = d
      best = i
    }
  })
  return best
}

/**
 * New exits: now and then a shallow tunnel tip far enough from the nest is dug up to the
 * surface. Ants going out take the exit nearest their destination (walking there underground)
 * and ants coming home may come in through one, so each exit opens new routes on the surface.
 */
export interface NestExit {
  /** The dug network node the exit rises from. */
  node: number
  /** Where it opens on the ground. */
  surface: Vector3
}
export const EXITS: NestExit[] = []
export const EXITS_MAX = 5
export const EXIT_CHANCE = 0.5
export const EXIT_MIN_FROM_NEST = SEARCHING_RADIUS * 1.2
export const EXIT_MIN_APART = SEARCHING_RADIUS * 1.5
/** Drawn radius of an exit's crater. */
export const EXIT_RADIUS = 3 * SYMBOL_SCALE
/** A tip must be this shallow (below the ground there) to be dug up into an exit. */
export const EXIT_MAX_DEPTH = SEARCHING_RADIUS * 0.8
/** An exit is used if the trip that way is at most this much longer than from the nest (ants go out near their goal). */
export const EXIT_GAIN = 1.1
/** A tip becomes an exit only if its tunnel route is at most this many times the straight line. */
export const EXIT_MAX_WINDING = 2

/** Waypoints from the nest, down the shaft and along the network, to node `i`. */
export const digPathTo = (i: number): Vector3[] => {
  const chain: Vector3[] = []
  // Built backwards (tip → root), each tunnel as its end then its bends; reversed at the end.
  for (let k = i; k >= 0; k = DIG_NETWORK[k].parent) chain.push(DIG_NETWORK[k].pos, ...[...DIG_NETWORK[k].via].reverse())
  return [new Vector3(0, 0, 0), ...chain.reverse().map((p) => p.clone())]
}
/** The midden rots: half of it is gone after this long. */
export const MIDDEN_HALF_LIFE_MS = 20 * 60e3
export const DIG_DEPTH_START = 0.25
export const DIG_DEPTH_RANGE = 0.3

/** A point on the surface at a random angle and radius in [minR, maxR], clear of `taken`. */
export const placeOnSurface = (
  taken: Vector3[],
  minR: number,
  maxR: number,
  clearR = FOOD_SPOT_RADIUS,
  attempts = PLACEMENT_ATTEMPTS,
): Vector3 => {
  let best: Vector3 | null = null
  let bestClearance = -1
  // Keep drawing until some clear ground turns up: a spot is never placed in water or rock.
  for (let i = 0; i < attempts || (!best && i < attempts * 20); i++) {
    const a = Math.random() * Math.PI * 2
    // Uniform over the annulus' AREA, not its radius, so spots don't bunch up near the nest.
    const rr = Math.sqrt(minR * minR + Math.random() * (maxR * maxR - minR * minR))
    const cx = Math.cos(a) * rr
    const cz = Math.sin(a) * rr
    if (!clearGround(cx, cz, clearR)) continue // its whole footprint on dry ground, clear of rocks
    const candidate = new Vector3(cx, groundAt(cx, cz), cz)
    if (farEnough(candidate, taken, MIN_SITE_DISTANCE)) return candidate
    const clearance = taken.length === 0 ? Infinity : Math.min(...taken.map((p) => Vector3.Distance(candidate, p)))
    if (clearance > bestClearance) {
      bestClearance = clearance
      best = candidate
    }
  }
  return best ?? new Vector3(minR, groundAt(minR, 0), 0)
}

/** Mutated in place on regeneration, so every live reader picks the new position up. */
export const TASK_POSITIONS: Record<TaskName, Vector3> = (() => {
  const R = SEARCHING_RADIUS
  const turn = Math.random() * Math.PI * 2
  const chamber = (angle: number, radius: number, depth: number): Vector3 =>
    new Vector3(Math.cos(turn + angle) * radius, -depth, Math.sin(turn + angle) * radius)
  const positions = {} as Record<TaskName, Vector3>
  // Interior: chambers spaced a quarter turn apart around the tunnel, at different depths.
  positions.QueenCare = chamber(0, 0.8 * R, 1.1 * R) // deep and central: the queen
  positions.EggLarvePupeaCare = chamber(Math.PI / 2, 0.9 * R, 0.8 * R) // nursery next to her
  positions.Store = chamber(Math.PI, 0.9 * R, 0.7 * R) // granary
  positions.Expansion = chamber((3 * Math.PI) / 2, 1.4 * R, 0.25 * R) // digging front, shallow
  // Surface: guard post near the entrance, midden further out, clear of everything else.
  const placed = Object.values(positions)
  positions.Protection = placeOnSurface(placed, 1.4 * R, 1.8 * R)
  placed.push(positions.Protection)
  positions.Cleaning = placeOnSurface(placed, 2.5 * R, 3.5 * R, MIDDEN_RADIUS)
  placed.push(positions.Cleaning)
  // No real place for these any more (scouts roam; food lives in FOOD_SPOTS), kept on the surface.
  positions.Exploration = placeOnSurface(placed, 3 * R, 4 * R)
  positions.Collect = placeOnSurface(placed, 3 * R, 4 * R)
  return positions
})()

export const TASK_PRIORITY: Record<TaskName, number> = {
  Protection: Math.random(),
  Exploration: Math.random(),
  QueenCare: Math.random(),
  EggLarvePupeaCare: Math.random(),
  Collect: Math.random(),
  Store: Math.random(),
  Expansion: Math.random(),
  Cleaning: Math.random(),
}

// ---------------------------------------------------------------------------
// Derived helpers
// ---------------------------------------------------------------------------

export const getDecreaseInterval = (): number => (CHECK_TIME_INTERVAL / 1e3 > 0.1 ? CHECK_TIME_INTERVAL / 1e3 : 0.1)

export const getPerformTaskInterval = (): number => Math.floor(Math.random() * CHECK_TIME_INTERVAL)

export const getSleepingInterval = (): number =>
  CHECK_TIME_INTERVAL + Math.random() * CHECK_TIME_INTERVAL + CHECK_TIME_INTERVAL * Math.floor(Math.random() * 24)

export const getRandomArbitrary = (min: number, max: number): number => Math.random() * (max - min) + min

// --- exploration range ------------------------------------------------------
// Exploring ants pick random targets; a site is found when a target lands within
// ±POS_DISCOVERED_TARGET_MATCH of it on x and z. Targets used to stop at a fixed ±2π·R
// (≈188), while expansion pushes the food spot out to 2.6× its placement radius (≈330),
// so a far spot could never be found and the whole colony searched forever.
//
// The range now follows the sites. It is not enough for it to merely reach the farthest
// one: the target distribution thins towards its edge, and the hit rate per trip drops
// from ~0.5% at 60% of the range to ~0.02% at 90% (≈5 min vs ≈2 h for 20 collectors).
// So the farthest site is kept at no more than EXPLORATION_COVERAGE of the range.
export const EXPLORATION_BASE_EXTENT = SEARCHING_RADIUS * Math.PI * 2
export const EXPLORATION_COVERAGE = 0.6

/** Half-width of the exploration box on each axis, re-derived on every call (sites move). */
export const explorationExtent = (): number => {
  // Food lives in FOOD_SPOTS; the Collect entry of TASK_POSITIONS is no longer a place.
  const places = [
    ...(Object.keys(TASK_POSITIONS) as TaskName[]).filter((t) => t !== 'Collect').map((t) => TASK_POSITIONS[t]),
    ...FOOD_SPOTS.map((spot) => spot.position),
  ]
  const farthest = Math.max(...places.map((p) => Math.max(Math.abs(p.x), Math.abs(p.z))))
  return Math.max(EXPLORATION_BASE_EXTENT, (farthest + POS_DISCOVERED_TARGET_MATCH) / EXPLORATION_COVERAGE)
}

export const randomPointInRadius = (positive: boolean): number =>
  Math.random() * (positive ? 1 : -1) * explorationExtent()

export const getGeneticOrientedTask = (type: AntType): TaskName => {
  const tasks = TASKS[type]
  return tasks[Math.floor(Math.random() * tasks.length)] as TaskName
}

// Naps last 0.5–1.5 check intervals. Was CHECK_TIME_INTERVAL / 24e3 (≈1–4 ms): a unit slip
// that made sleep invisible. Real workers take many short naps inside the nest
// (fire ants: ~250 naps/day of ~1 min, Cassill et al. 2009).
export const getNapDuration = (): number => CHECK_TIME_INTERVAL * (0.5 + Math.random()) * restFactor

/** Seasonal rest: naps last longer in the cold (set by the Colony from the current season). */
let restFactor = 1
export const setRestFactor = (value: number): void => {
  restFactor = Math.max(0.1, value)
}

// Sleep chamber: below the nest, not out in the field.
export const SLEEP_CHAMBER_RADIUS = 10 * SYMBOL_SCALE

// ---------------------------------------------------------------------------
// Colony economy (dynamic population)
// ---------------------------------------------------------------------------
// Food comes in with Collect deliveries, spoils unless Store work keeps up, and every
// living ant eats. The queen lays when there is food and she is cared for. Foraging has
// diminishing returns (a patch can only feed so many collectors), which is what gives the
// colony a carrying capacity instead of "grow to the cap or die".

export const ECONOMY_TICK_MS = 1e3
export const FOOD_PER_DELIVERY = 22 // × the ant's delivered work value
export const FORAGING_PATCH = 40 // collectors at which each trip yields half
export const FOOD_PER_ANT_PER_MIN: Record<AntType, number> = { W: 1, P: 2 }
export const SPOILAGE_PER_MIN = 0.02 // share of the store lost per minute with no Store work
export const INITIAL_FOOD_MINUTES = 30 // starting reserve, in minutes of colony consumption
export const QUEEN_EGGS_PER_MIN_MAX = 24
export const QUEEN_FOOD_HALF_RESERVE_MIN = 10 // reserve (minutes) at which laying runs at half speed
export const EGG_FOOD_COST = 3
export const STARVATION_DEATHS_PER_MIN = 0.1 // share of the colony dying per minute with an empty store
export const HUNGER_FEEDBACK = true // low reserve raises Collect need (Gordon: foraging tracks returns)
export const HUNGER_TARGET_RESERVE_MIN = 5
export const HUNGER_COLLECT_NEED_PER_MIN = 2

// ---------------------------------------------------------------------------
// Food is a finite thing lying on the ground, not a tap
// ---------------------------------------------------------------------------
// A spot holds a random amount, because in nature it is whatever happens to be there:
// usually a seed, occasionally a crumb of bread. The draw is LOG-UNIFORM and skewed
// towards the small end, so most finds are modest and a windfall is rare. A uniform draw
// would make every spot feel the same size, which is exactly what we are trying to avoid.
//
// SKEW > 1 pushes the mass towards the minimum. At 2.2 roughly two thirds of spots sit in
// the bottom quarter of the range.
export const FOOD_SITE_MIN = 150 // a seed
export const FOOD_SITE_MAX = 6000 // a piece of bread
export const FOOD_SITE_SKEW = 2.2

export const rollFoodAmount = (): number =>
  FOOD_SITE_MIN * Math.pow(FOOD_SITE_MAX / FOOD_SITE_MIN, Math.pow(Math.random(), FOOD_SITE_SKEW))

// ---------------------------------------------------------------------------
// Food spots: several, and more as the foraging area grows
// ---------------------------------------------------------------------------
// Food used to be ONE site (TASK_POSITIONS.Collect): when it emptied, the whole colony lost
// its only source and all its food knowledge at once. Now the ground holds several spots at
// a constant DENSITY: the spawn radius grows with expansion ("reach"), the area with reach²,
// and so does the number of spots. Each spot is finite and respawns elsewhere when emptied.
//
// A spot's `epoch` changes on every respawn. Ants remember a spot together with the epoch
// and position they learned, so a memory of an emptied spot is stale, and the ant only
// finds that out by walking there and finding nothing.
export interface FoodSpot {
  id: number
  epoch: number
  position: Vector3
  remaining: number
  initial: number
}

export const FOOD_SPOTS_AT_BASE_REACH = 3
export const FOOD_SPOTS_MAX = 12

// ---------------------------------------------------------------------------
// Environment: how rich the ground is
// ---------------------------------------------------------------------------
// One multiplier for the environment the colony lives in. It scales both how MANY spots the
// ground holds (density) and how MUCH food each new spot holds. Settable live from the HUD:
// richer shows up at once (new spots appear, new spots are bigger); poorer sets in as it
// would in nature: food already on the ground stays, but emptied spots are not replaced
// until the count matches the new level.
export const FOOD_AVAILABILITY = 1

// ---------------------------------------------------------------------------
// Seasons
// ---------------------------------------------------------------------------
// A temperate year. Seasons change how the colony LIVES, not only how much food there is:
// real colonies survive winter by storing food in the good months and slowing right down in
// the cold (the queen stops laying, ants barely eat and mostly rest in the nest). With food
// alone, every winter would be a famine.
//
// FOOD_AVAILABILITY is the climate's baseline and the season multiplies it, so a rich
// climate has mild winters and a poor one hard ones.
// 'cycle' = the year turns; 'hold' = stay in the chosen season (e.g. watch a long winter).
export type SeasonMode = 'cycle' | 'hold'
export const SEASON_MODE: SeasonMode = 'cycle'
/** One year of sim time: 40 min, i.e. 10 per season (≈ 2.5 real minutes at 16×). */
export const YEAR_MS = 40 * 60e3
/** Share of each season spent blending into the next, so nothing changes overnight. */
export const SEASON_BLEND = 0.3

export interface Season {
  name: 'Spring' | 'Summer' | 'Autumn' | 'Winter'
  /** × food availability (spots and their size). */
  food: number
  /** × how much every ant eats. */
  eat: number
  /** × the queen's laying rate. */
  lay: number
  /** × nap length: more rest = more of the colony asleep at any time. */
  rest: number
  /** × spoilage of the store (heat spoils food). */
  spoil: number
  /**
   * × how fast ants age. Cold slows the body down: workers that overwinter live far longer
   * than summer workers, which is how a colony gets through the months the queen barely lays.
   */
  aging: number
  /** Ground-grid tint, a faint cue in 3D. */
  tint: [number, number, number]
  /** 0..1 how frozen the ground is (EXPERIMENT_FROZEN_GROUND). */
  frost: number
  /** Soil colour: the ground plane blends through these over the whole year. Kept dark. */
  ground: [number, number, number]
}

export const SEASONS: Season[] = [
  { name: 'Spring', food: 1.5, eat: 1, lay: 1.2, rest: 1, spoil: 1, aging: 1, tint: [0.3, 0.36, 0.28], frost: 0, ground: [0.13, 0.2, 0.11] },
  { name: 'Summer', food: 2, eat: 1.1, lay: 1, rest: 1, spoil: 1.5, aging: 1.1, tint: [0.38, 0.34, 0.24], frost: 0, ground: [0.21, 0.2, 0.1] },
  { name: 'Autumn', food: 0.75, eat: 1, lay: 0.6, rest: 1.8, spoil: 1, aging: 0.7, tint: [0.38, 0.28, 0.2], frost: 0.15, ground: [0.21, 0.13, 0.08] },
  { name: 'Winter', food: 0.25, eat: 0.4, lay: 0.1, rest: 6, spoil: 0.3, aging: 0.25, tint: [0.3, 0.33, 0.4], frost: 1, ground: [0.15, 0.17, 0.21] },
]

/**
 * EXPERIMENTAL: frozen ground. In the cold the soil is hard, so digging (Expansion work)
 * achieves much less. Shown as frost on the ground and icy soil heaps. Switch off to remove.
 */
export const EXPERIMENT_FROZEN_GROUND = true
/** Share of digging effect lost on fully frozen ground. */
export const FROST_DIG_LOSS = 0.8


export const FOOD_AVAILABILITY_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3] as const
/** Performance ceiling on spots even in the richest environment. */
export const FOOD_SPOTS_HARD_MAX = 30

/** Spots the ground should hold for a given spawn reach (1 = starting radius) and richness. */
export const foodSpotTarget = (reach: number, availability = 1): number =>
  Math.min(
    Math.min(FOOD_SPOTS_HARD_MAX, Math.round(FOOD_SPOTS_MAX * Math.max(1, availability))),
    Math.max(1, Math.round(FOOD_SPOTS_AT_BASE_REACH * reach * reach * availability)),
  )

/**
 * Only fresh news recruits. A memory records when food was last SEEN at the spot (by this
 * ant, or by whoever it heard from: hearsay keeps its age). Ants only pass on memories
 * confirmed within this window. Without it, memories of emptied spots circulated forever:
 * ants that found nothing relearned the dead spot from nestmates at the nest (headless:
 * 99 of 103 ants "knew" food while intake fell to 9/min and the colony starved).
 */
export const FOOD_NEWS_FRESH_MS = 3 * 60e3

// ---------------------------------------------------------------------------
// Roles on the ground (movement only: task choice is untouched)
// ---------------------------------------------------------------------------
// Protection is an AREA: patrollers walk to points spread through a band around the nest,
// inside the territory. The Colony keeps the band's outer edge in step with the territory.
export const PATROL_BAND = { inner: 0, outer: 0 }
/** A random dry point in the patrol band. */
export const getPatrolPoint = (): Vector3 => {
  let x = 0
  let z = 0
  for (let i = 0; i < 12; i++) {
    const a = Math.random() * Math.PI * 2
    const r = Math.sqrt(PATROL_BAND.inner ** 2 + Math.random() * (PATROL_BAND.outer ** 2 - PATROL_BAND.inner ** 2))
    x = Math.cos(a) * r
    z = Math.sin(a) * r
    if (TERRAIN.passable(x, z)) break
  }
  return new Vector3(x, groundAt(x, z), z)
}

// Dirt is physical: spoil from digging, scraps from food, and ants that die near the nest
// lie around it until a cleaner carries them to the midden. (The Cleaning NEED is unchanged;
// this is where cleaners walk.)
export interface Debris {
  x: number
  z: number
  kind: 'spoil' | 'scrap' | 'corpse'
  /** A cleaner on its way to it, until this sim time. */
  claimedUntil: number
}
export const DEBRIS: Debris[] = []
export const DEBRIS_MAX = 40

/** Live registry, owned by the Colony; ants and the view read it. */
export const FOOD_SPOTS: FoodSpot[] = []

/** A spot with food on it within the discovery window of `pos` (x/z, like every site). */
export const foodSpotNear = (pos: Vector3): FoodSpot | null =>
  FOOD_SPOTS.find(
    (spot) =>
      spot.remaining > 0 &&
      Math.abs(spot.position.x - pos.x) <= POS_DISCOVERED_TARGET_MATCH &&
      Math.abs(spot.position.z - pos.z) <= POS_DISCOVERED_TARGET_MATCH,
  ) ?? null

// ---------------------------------------------------------------------------
// Expansion is visible, and it pushes the food away
// ---------------------------------------------------------------------------
// Digging widens the nest, and a wider nest means the easy food nearby is already taken,
// so the next spot is drawn from further out. Both are driven by the same expansion level,
// a 0..1 saturating measure of how much Expansion work the colony has banked.
export const NEST_BASE_DIAMETER = 14 * SYMBOL_SCALE
export const NEST_MAX_DIAMETER = 44 * SYMBOL_SCALE
/** The anthill's cleared ground reaches this many times the mound's radius (nothing is placed on it). */
export const NEST_CLEARING = 1.5
export const EXPANSION_HALF_LEVEL = 400 // banked Expansion work at which the nest is half grown
export const FORAGE_RANGE_AT_FULL_EXPANSION = 2.6 // multiplies the placement radius

// A bigger nest and a bigger colony both make more mess, and a fuller store needs more
// places to put things. Both pressures are per-minute, applied in the economy tick next to
// the existing hunger feedback rather than being generated by ant interactions.
export const CLEANING_NEED_PER_ANT_PER_MIN = 0.012
export const STORE_NEED_PER_FOOD_PER_MIN = 0.0016

// ---------------------------------------------------------------------------
// How finishing one task raises the need for others
// ---------------------------------------------------------------------------
// Declared as WEIGHTS that are normalised at use, rather than as hand-written divisors.
// The divisors were expressed against the task count (`rest / (totalTasks / 4)`), which had
// two consequences nobody wanted: Collect and Expansion only ever handed on half their
// secondary budget (1/8 + 1/8 + 1/4 = 0.5, where every other case summed to 1), and adding
// a ninth task would silently have reweighted all eight. Normalising makes the leak
// impossible to write and decouples the weights from how many tasks exist.
//
// `main` is the dominant consequence of doing the work. `rest` is everything else it
// stirs up, split by weight.
export interface TaskInfluence {
  main: TaskName
  rest: Partial<Record<TaskName, number>>
}

// Brood care is NOT in any `rest` below: its need comes from the brood itself (see Brood),
// so it follows the eggs laid instead of the other tasks' work.
export const TASK_INFLUENCE: Record<TaskName, TaskInfluence> = {
  // Guarding the nest is hungry work, and it keeps the brood chamber attended.
  Protection: { main: 'Collect', rest: { QueenCare: 1 } },
  // Scouts come back with somewhere new to defend.
  Exploration: { main: 'Protection', rest: { QueenCare: 1 } },
  // Food arriving has to be put away, which fills the nest and makes mess.
  Collect: { main: 'Store', rest: { Expansion: 1, Cleaning: 1, Exploration: 2 } },
  // A fuller store needs more chambers, and a worked store needs tidying.
  Store: { main: 'Expansion', rest: { Exploration: 1, Cleaning: 1 } },
  // Digging makes spoil to clear, new chambers to stock, and brood room to use.
  Expansion: { main: 'Cleaning', rest: { QueenCare: 1, Exploration: 2, Store: 1 } },
  Cleaning: { main: 'Protection', rest: { Exploration: 1 } },
  QueenCare: { main: 'Collect', rest: { Expansion: 1 } },
  EggLarvePupeaCare: { main: 'Expansion', rest: { Collect: 1 } },
}

/** Share of a delivery that goes to the main consequence; the remainder is split by weight. */
export const INFLUENCE_MAIN_SHARE = 0.6

// Need and supply are running totals. Without decay their ratio converges to the long-run
// rate and the colony stops reacting: measured over a long run, a need spike that moved
// urgency by 0.167 early moved it by 0.00003 later. Decaying both on every economy tick
// turns urgency into a ratio of RECENT rates, so responsiveness stays constant.
export const NEED_HALF_LIFE_MIN = 2
/** Floor under `actual` so a decayed supply cannot divide urgency to infinity. */
export const NEED_ACTUAL_FLOOR = 0.25

// ---------------------------------------------------------------------------
// Task switching: response thresholds + encounter-based staffing
// ---------------------------------------------------------------------------
// The 2021 rule compared the SAME global urgencies for every ant, and urgency only falls
// once work is delivered. So when one task became most urgent, every ant switched to it
// on its next nest visit and every other task drained to min_dedicated_ants (headless:
// Cleaning 102 → Brood care 165 → Food collection 169 → Queen care 127, 10 min apart).
//
// 'threshold' (default) fixes both halves of that:
//   * Staffing is felt locally, as in Gordon's harvesters: each ant keeps a fading tally
//     of whom it meets, by task, and discounts urgency for tasks it keeps bumping into.
//     This reacts as soon as ants join a task, long before their work is delivered.
//   * Switching is stochastic with individual thresholds (Bonabeau et al. 1996):
//     P(switch) = s² / (s² + θ²), s = how much more pressing the candidate looks than the
//     current task, θ = the ant's own threshold for it (lower for higher geneticalPriority).
// 'legacy' keeps the original rankTasks/shouldSwitchTask behaviour for comparison.
export type SwitchModel = 'threshold' | 'legacy'
export const SWITCH_MODEL: SwitchModel = 'threshold'
/** Encounter tally half-life. Old meetings stop counting after a few trips. */
export const ENCOUNTER_HALF_LIFE_MS = 60e3
/** The same partner is only counted again after this long (contact lasts several frames). */
export const ENCOUNTER_COOLDOWN_MS = 3e3
/** Pseudo-count per task, so an ant that has met nobody assumes even staffing. */
export const ENCOUNTER_PRIOR = 0.5
/** θ for an ant with geneticalPriority 2 (most eager); priority 1 doubles it. */
export const SWITCH_THRESHOLD_BASE = 0.6
/** Log-normal spread of individual thresholds around that value. */
export const SWITCH_THRESHOLD_SPREAD = 0.35

// ---------------------------------------------------------------------------
// Lifespan
// ---------------------------------------------------------------------------
// Was lifeTime ∈ [r, 2r] with r uniform from 0: some ants died minutes after birth.
// Real workers cluster around a typical age (harvester workers ≈ a year, fire ants 1–6
// months) and most die outside the nest. Now: a clustered intrinsic lifespan, plus extra
// risk while doing exterior work, which is what shortens foragers' lives.
export const LIFESPAN_MEAN_MS = 22.5 * CHECK_TIME_INTERVAL
export const LIFESPAN_SPREAD = 0.4 // lifespan ∈ mean × [1 − spread, 1 + spread]
export const getLifespan = (): number => LIFESPAN_MEAN_MS * (1 - LIFESPAN_SPREAD + 2 * LIFESPAN_SPREAD * Math.random())
/** Gordon's exterior tasks: foraging, patrolling, midden work, nest maintenance. */
export const EXTERIOR_TASKS: TaskName[] = ['Collect', 'Exploration', 'Protection', 'Cleaning', 'Expansion']
/** Extra death risk per minute for an awake ant on an exterior task (≈ one mean life of exposure → 1/3 die early). */
export const EXTERIOR_HAZARD_PER_MIN = 1 / (3 * (LIFESPAN_MEAN_MS / 60e3))

export const getReproductionTime = (): number =>
  REPRODUCTION_ON ? Math.floor(Math.random() * CHECK_TIME_INTERVAL * 30) : 0

/**
 * TRIAL (revert by setting false): search on the ground. Random search points used to have a
 * random height too, a leftover from when sites floated in the air, so scouts and searching
 * collectors flew up and down through a sphere. Everything they look for now lies on the
 * surface, so they search the surface: the territory really is the disc inside the fence.
 */
export const FLAT_EXPLORATION = true

/** TRIAL (revert by setting false): draw the nest's underground volume as a faint bowl. */
export const NEST_BOWL = true

export const getRandomTarget = (): Vector3 => {
  // Search points on dry, open ground (a few retries; the last draw is used regardless).
  let x = 0
  let z = 0
  for (let i = 0; i < 12; i++) {
    x = getRandomArbitrary(randomPointInRadius(false), randomPointInRadius(true))
    z = getRandomArbitrary(randomPointInRadius(false), randomPointInRadius(true))
    if (TERRAIN.passable(x, z)) break
  }
  const y = FLAT_EXPLORATION ? groundAt(x, z) : getRandomArbitrary(randomPointInRadius(false), randomPointInRadius(true))
  return new Vector3(x, y, z)
}

export const getSize = (type: AntType): 'big' | 'small' => (type === 'P' ? 'big' : 'small')

export const getAntObject = (type: AntType): AntData => ({
  id: uuidv1(),
  type,
  size: getSize(type),
  bornAt: simNow(),
  generation: 1,
  cloned: false,
  animation: null,
  awakeTime: null,
  reproductionOn: false,
  sleeping: true,
  reproductionTime: 0,
  lifeTime: 0,
  totalAntsInNest: 0,
  behaviour: {
    actualTask: {
      type: getGeneticOrientedTask(type),
      interactionPercentage: Math.floor(Math.random() * 1),
      lastInteraction: simNow(),
    },
    rankTasks: {},
    discoveredPositions: {
      // The patrol band is around the nest: known from birth, like the interior.
      Protection: true,
      Exploration: !AUTODISCOVERING,
      // Interior chambers: known from birth (workers emerge inside the nest).
      QueenCare: true,
      EggLarvePupeaCare: true,
      Collect: !AUTODISCOVERING,
      Store: true,
      Expansion: true,
      Cleaning: !AUTODISCOVERING,
    },
    geneticalPriority: {
      Protection: Math.random() + 1,
      Exploration: Math.random() + 1,
      QueenCare: Math.random() + 1,
      EggLarvePupeaCare: Math.random() + 1,
      Collect: Math.random() + 1,
      Store: Math.random() + 1,
      Expansion: Math.random() + 1,
      Cleaning: Math.random() + 1,
    },
  },
  body: null,
  babylonElements: null,
})

// ---------------------------------------------------------------------------
// Brood: eggs develop before they become workers
// ---------------------------------------------------------------------------
// Laid eggs are not ants yet. They are brood (egg → larva → pupa) for BROOD_DEV_MS, and they
// need care and food on the way, like real brood:
//   * brood-care NEED comes from the brood itself (per brood per minute), so it booms in
//     spring and all but vanishes in winter, following the eggs actually laid;
//   * care speeds development (well-tended brood takes BROOD_DEV_MS, neglected up to 4×
//     longer) and neglect kills some of it;
//   * larvae eat;
//   * in famine the colony eats its own brood and gets part of the food back, as real
//     colonies do: brood is the colony's buffer against starvation.
/** Egg to adult: ~30% of a worker's mean life (fire ants: ~1 month of ~3). */
export const BROOD_DEV_MS = 0.3 * LIFESPAN_MEAN_MS
export const BROOD_CARE_NEED_PER_MIN = 0.35
export const BROOD_FOOD_PER_MIN = 0.4
/** Share of neglected brood dying per minute at zero care (scales with (1 − care)²). */
export const BROOD_NEGLECT_DEATHS_PER_MIN = 0.12
/** Share of brood eaten per minute while the store is empty. */
export const BROOD_CANNIBALISM_PER_MIN = 0.25
/** Food recovered per brood eaten, as a share of what an egg cost. */
export const BROOD_CANNIBALISM_RETURN = 0.6
