import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { v1 as uuidv1 } from 'uuid'

import { simNow } from './commons/simClock'

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
export const WORLD_SCALE = 3e2
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

const getRandomPos = (): number =>
  Math.random() * (SEARCHING_RADIUS * (Math.PI * 1.35) - SEARCHING_RADIUS / 2) + SEARCHING_RADIUS / 2

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
export const SITE_FOOTPRINT = 12 // matches BASE_DIAMETER in the view
export const SITE_SEPARATION_RATIO = 2.5
export const MIN_SITE_DISTANCE = SITE_FOOTPRINT * SITE_SEPARATION_RATIO
const PLACEMENT_ATTEMPTS = 60

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
export const placeSite = (task: TaskName, taken: Vector3[], scale = 1): Vector3 => {
  const [sx, sy, sz] = SITE_OCTANT[task]
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

/** Mutated in place on regeneration, so every live reader picks the new position up. */
export const TASK_POSITIONS: Record<TaskName, Vector3> = (() => {
  const placed: Vector3[] = []
  const positions = {} as Record<TaskName, Vector3>
  for (const task of Object.keys(SITE_OCTANT) as TaskName[]) {
    const pos = placeSite(task, placed)
    placed.push(pos)
    positions[task] = pos
  }
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
  const farthest = Math.max(
    ...Object.values(TASK_POSITIONS).map((p) => Math.max(Math.abs(p.x), Math.abs(p.z))),
  )
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
export const getNapDuration = (): number => CHECK_TIME_INTERVAL * (0.5 + Math.random())

// Sleep chamber: below the nest, not out in the field.
export const SLEEP_CHAMBER_RADIUS = 10

// ---------------------------------------------------------------------------
// Colony economy (dynamic population)
// ---------------------------------------------------------------------------
// Food comes in with Collect deliveries, spoils unless Store work keeps up, and every
// living ant eats. The queen lays when there is food and she is cared for. Foraging has
// diminishing returns (a patch can only feed so many collectors), which is what gives the
// colony a carrying capacity instead of "grow to the cap or die".

export const ECONOMY_TICK_MS = 1e3
export const FOOD_PER_DELIVERY = 10 // × the ant's delivered work value
export const FORAGING_PATCH = 40 // collectors at which each trip yields half
export const FOOD_PER_ANT_PER_MIN: Record<AntType, number> = { W: 1, P: 2 }
export const SPOILAGE_PER_MIN = 0.02 // share of the store lost per minute with no Store work
export const INITIAL_FOOD_MINUTES = 30 // starting reserve, in minutes of colony consumption
export const QUEEN_EGGS_PER_MIN_MAX = 24
export const QUEEN_FOOD_HALF_RESERVE_MIN = 3 // reserve (minutes) at which laying runs at half speed
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
// Expansion is visible, and it pushes the food away
// ---------------------------------------------------------------------------
// Digging widens the nest, and a wider nest means the easy food nearby is already taken,
// so the next spot is drawn from further out. Both are driven by the same expansion level,
// a 0..1 saturating measure of how much Expansion work the colony has banked.
export const NEST_BASE_DIAMETER = 14
export const NEST_MAX_DIAMETER = 44
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

export const TASK_INFLUENCE: Record<TaskName, TaskInfluence> = {
  // Guarding the nest is hungry work, and it keeps the brood chamber attended.
  Protection: { main: 'Collect', rest: { QueenCare: 1, EggLarvePupeaCare: 1 } },
  // Scouts come back with somewhere new to defend.
  Exploration: { main: 'Protection', rest: { QueenCare: 1, EggLarvePupeaCare: 1 } },
  // Food arriving has to be put away, which fills the nest and makes mess.
  Collect: { main: 'Store', rest: { Expansion: 1, Cleaning: 1, Exploration: 2 } },
  // A fuller store needs more chambers, and a worked store needs tidying.
  Store: { main: 'Expansion', rest: { Exploration: 1, Cleaning: 1 } },
  // Digging makes spoil to clear, new chambers to stock, and brood room to use.
  Expansion: { main: 'Cleaning', rest: { QueenCare: 1, EggLarvePupeaCare: 1, Exploration: 2, Store: 1 } },
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

export const getRandomTarget = (): Vector3 =>
  new Vector3(
    getRandomArbitrary(randomPointInRadius(false), randomPointInRadius(true)),
    getRandomArbitrary(randomPointInRadius(false), randomPointInRadius(true)),
    getRandomArbitrary(randomPointInRadius(false), randomPointInRadius(true)),
  )

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
      Protection: !AUTODISCOVERING,
      Exploration: !AUTODISCOVERING,
      QueenCare: !AUTODISCOVERING,
      EggLarvePupeaCare: !AUTODISCOVERING,
      Collect: !AUTODISCOVERING,
      Store: !AUTODISCOVERING,
      Expansion: !AUTODISCOVERING,
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
