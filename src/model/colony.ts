import { ArcRotateCamera, Scene, Vector3 } from '@babylonjs/core'

import Ant from '../classes/ant'
import { simNow, simSetInterval } from '../commons/simClock'
import {
  ActualTask,
  AntType,
  EXTERIOR_HAZARD_PER_MIN,
  EXTERIOR_TASKS,
  LIFESPAN_MEAN_MS,
  ECONOMY_TICK_MS,
  EGG_FOOD_COST,
  FOOD_PER_ANT_PER_MIN,
  FOOD_PER_DELIVERY,
  FORAGING_PATCH,
  HUNGER_COLLECT_NEED_PER_MIN,
  HUNGER_FEEDBACK,
  HUNGER_TARGET_RESERVE_MIN,
  INITIAL_ANTS,
  INITIAL_FOOD_MINUTES,
  NestNeed,
  NestNeeds,
  POPULATION_CAP,
  QUEEN_EGGS_PER_MIN_MAX,
  QUEEN_FOOD_HALF_RESERVE_MIN,
  REPRODUCTION_ON,
  SPOILAGE_PER_MIN,
  STARVATION_DEATHS_PER_MIN,
  TASK_POSITIONS,
  TaskName,
  WORLD_SCALE,
  CLEANING_NEED_PER_ANT_PER_MIN,
  EXPANSION_HALF_LEVEL,
  FORAGE_RANGE_AT_FULL_EXPANSION,
  NEST_BASE_DIAMETER,
  NEST_MAX_DIAMETER,
  STORE_NEED_PER_FOOD_PER_MIN,
  INFLUENCE_MAIN_SHARE,
  NEED_ACTUAL_FLOOR,
  NEED_HALF_LIFE_MIN,
  TASK_INFLUENCE,
  BROOD_CANNIBALISM_PER_MIN,
  BROOD_CANNIBALISM_RETURN,
  BROOD_CARE_NEED_PER_MIN,
  BROOD_DEV_MS,
  BROOD_FOOD_PER_MIN,
  BROOD_NEGLECT_DEATHS_PER_MIN,
  EXPERIMENT_FROZEN_GROUND,
  FROST_DIG_LOSS,
  DIG_DEPTH_RANGE,
  DIG_DEPTH_START,
  FOOD_AVAILABILITY,
  TRAILS,
  TRAILS_ON,
  TRAIL_HALF_LIFE_MS,
  NO_ENTRY_ON,
  NO_ENTRY_HALF_LIFE_MS,
  SEASONS,
  SEASON_BLEND,
  SEASON_MODE,
  Season,
  SeasonMode,
  YEAR_MS,
  setRestFactor,
  DEBRIS,
  DIG_NETWORK,
  ROOM_UNIT_HOLDS,
  RoomRole,
  DigNode,
  roomCapacity,
  EXITS,
  EXITS_MAX,
  EXIT_CHANCE,
  EXIT_MAX_DEPTH,
  EXIT_MIN_APART,
  EXIT_MIN_FROM_NEST,
  EXIT_MAX_WINDING,
  digPathTo,
  DIG_NETWORK_MAX,
  DIG_TUNNEL_LENGTH,
  DIG_SHAFT_SHARE,
  DIG_SHAFT_DROP,
  DIG_MAX_DEPTH,
  DIG_WANDER,
  DIG_DEPTH_SCALE,
  DIG_VERTICAL_ROOM,
  DIG_WORK_PER_TUNNEL,
  SLEEP_POSITION,
  MIDDEN_HALF_LIFE_MS,
  FOUNDING,
  FOUNDING_HOLDS,
  START_ROOM_RADIUS,
  UNSTORED_SPOIL_PER_MIN,
  UNHOUSED_BROOD_CARE,
  EXPANSION_CROWDING_NEED_PER_MIN,
  DEBRIS_MAX,
  FOOD_SPOTS,
  PATROL_BAND,
  TERRAIN,
  groundAt,
  isUnderground,
  FoodSpot,
  INCREASE_MAIN_TASK,
  foodSpotTarget,
  SEARCHING_RADIUS,
  SITE_RADIUS_MAX,
  placeOnSurface,
  clearGround,
  FOOD_SPOT_RADIUS,
  MIDDEN_RADIUS,
  EXIT_RADIUS,
  NEST_CLEARING,
  rollFoodAmount,
} from '../constants'

// Colony-level model: nest needs, the food economy, the queen, births and deaths.
// No DOM and no rendering here, so it runs the same in the browser and headless
// (scripts/headless.ts). The view subscribes through `events`.

export interface ColonyEvents {
  delivered?: (task: TaskName) => void
  born?: () => void
  died?: (at: Vector3) => void
  knowledgeShared?: (at: Vector3) => void
  /** Diggers broke through to the surface: a new exit. */
  exitDug?: (at: Vector3) => void
  /** A new season began (cycle mode). */
  seasonChanged?: (name: Season['name']) => void
  /** A counted encounter, reported by `ant` (each side of a meeting reports it once). */
  encountered?: (ant: Ant, other: Ant) => void
  /** A food spot was exhausted and a new one appeared somewhere else. */
  foodSiteMoved?: (at: Vector3, amount: number) => void
}

/** Why the queen is laying at less than full speed. */
export type LayLimit = 'food' | 'care' | 'cap' | 'none'

// A generation is one mean intrinsic lifespan of sim time.
const MEAN_LIFESPAN_MS = LIFESPAN_MEAN_MS
// Births/deaths per minute are reported as a ~3-minute moving average.
const RATE_WINDOW_MIN = 3

// Rates are reported as ~30-tick moving averages; single deliveries are too bursty to read.
const smooth = (prev: number, next: number): number => prev + (next - prev) / 30

/**
 * Raise (or lower) a need, never below zero.
 *
 * `urgency = need / actual`, and the ants rank tasks by multiplying by urgency and comparing
 * the products (ant.ts). A negative need therefore does not mean "less urgent", it flips the
 * sign of the comparison and inverts the ranking. Deaths subtract a whole point from Expansion
 * while births only add 0.03-0.05, so a starvation cascade reaches negative easily; clamping
 * here is what keeps that from silently inverting the colony's priorities.
 */
const bump = (need: NestNeed, by: number): void => {
  need.need = Math.max(0, need.need + by)
}

const baseNeed = (): NestNeed => ({
  urgency: 1,
  actual: 1,
  need: 0,
  min_dedicated_ants: 1,
  dedicated_ants: 1,
})

export class Colony {
  readonly ants: Ant[] = []
  readonly needs: NestNeeds = {
    Protection: baseNeed(),
    Exploration: baseNeed(),
    Collect: baseNeed(),
    Store: baseNeed(),
    Cleaning: baseNeed(),
    Expansion: baseNeed(),
    QueenCare: baseNeed(),
    EggLarvePupeaCare: baseNeed(),
  }
  readonly events: ColonyEvents = {}
  /** Room for each role (founding / sleep chamber + dug rooms with that role), and what has none. */
  readonly roomSpace: Record<RoomRole, number> = { sleep: 0, brood: 0, store: 0 }
  readonly unhoused: Record<RoomRole, number> = { sleep: 0, brood: 0, store: 0 }

  births = 0
  deaths = 0
  starved = 0
  /** Deaths from the extra risk of exterior work (the rest of `deaths` is old age + starvation). */
  diedOutside = 0
  /** Moving averages, per minute. */
  birthsPerMin = 0
  deathsPerMin = 0
  food = 0
  /** Eggs per minute the queen is currently laying. */
  layRate = 0
  layLimit: LayLimit = 'none'
  /** Food per minute: last tick's intake, spoilage and consumption. */
  intakePerMin = 0
  spoilagePerMin = 0
  consumptionPerMin = 0

  /** What is left in the current food spot, and what it held when it appeared. */
  /** Food spots on the ground (the live registry in constants). */
  readonly foodSpots = FOOD_SPOTS
  /** Environment richness (see FOOD_AVAILABILITY). Change it live with setFoodAvailability. */
  foodAvailability = FOOD_AVAILABILITY
  /** 'cycle' = seasons turn over time; 'hold' = stay in heldSeason. */
  seasonMode: SeasonMode = SEASON_MODE
  /** Season index kept while holding. */
  heldSeason = 0
  /** Current (blended) season factors. */
  season: Omit<Season, 'name' | 'tint' | 'ground'> & {
    name: Season['name'] | 'None'
    progress: number
    tint: [number, number, number]
    ground: [number, number, number]
  } = {
    name: 'None', food: 1, eat: 1, lay: 1, rest: 1, spoil: 1, aging: 1, frost: 0, progress: 0, tint: [0.3, 0.3, 0.28], ground: [0.1, 0.1, 0.1],
  }
  private seasonStart = 0
  private nextSpotId = 0
  /** Spots exhausted so far, purely for the HUD. */
  foodSitesDepleted = 0

  private readonly reachedNest = new Set<string>()
  private collectors = 0
  /** Total Expansion work ever banked. Never decays: a dug chamber stays dug. */
  private expansionWork = 0
  private intakeThisTick = 0
  private eggProgress = 0
  /** Brood in development: each item is 0..1 of the way to emerging as a worker. */
  readonly brood: { progress: number }[] = []
  broodEmerged = 0
  broodDied = 0
  broodEaten = 0
  private broodDeathProgress = 0
  private broodEatProgress = 0
  private births0 = 0
  private deaths0 = 0
  private starveProgress = 0

  /**
   * How far the nest has been dug out, 0..1, saturating.
   *
   * Driven by banked Expansion work rather than by population, so digging is something the
   * colony *does* rather than something that happens to it. Saturates because a nest cannot
   * grow without bound, and because both readers (dome size, foraging range) want a bounded
   * factor to interpolate with.
   *
   * Reads `expansionWork`, not `needs.Expansion.actual`: that one decays, so it measures the
   * current rate of digging. A nest built off a rate would shrink whenever the diggers moved on.
   */
  get expansionLevel(): number {
    return this.expansionWork / (this.expansionWork + EXPANSION_HALF_LEVEL)
  }

  /** Current dome diameter, which the view reads every frame. */
  get nestDiameter(): number {
    return NEST_BASE_DIAMETER + (NEST_MAX_DIAMETER - NEST_BASE_DIAMETER) * this.expansionLevel
  }

  /** Share of the current spot still on the ground, 0..1. */
  /** Spawn radius multiplier: expansion pushes the easy food out, and widens the area. */
  get foodReach(): number {
    return 1 + (FORAGE_RANGE_AT_FULL_EXPANSION - 1) * this.expansionLevel
  }

  /** Spots at least one living ant currently knows (a memory of the spot as it is now). */
  get foodSpotsKnown(): number {
    const known = new Set<FoodSpot>()
    this.ants.forEach((a) => {
      const m = a.foodMemory
      if (m && m.epoch === m.spot.epoch) known.add(m.spot)
    })
    return known.size
  }

  constructor(
    private readonly scene: Scene,
    private readonly camera: ArcRotateCamera,
  ) {}

  start(count = INITIAL_ANTS): void {
    this.updatePatrolBand()
    // The network starts as the shaft (node 0) and the first digging front off it.
    const front = TASK_POSITIONS.Expansion
    DIG_NETWORK.push({ pos: new Vector3(0, front.y, 0), parent: -1, room: 0, role: null, sleepers: 0, fill: 0, via: [] })
    // The first store room and nursery, already dug where the built granary and nursery were.
    DIG_NETWORK.push({ pos: TASK_POSITIONS.Store.clone(), parent: 0, room: START_ROOM_RADIUS.store, role: 'store', sleepers: 0, fill: 0, via: [] })
    DIG_NETWORK.push({ pos: TASK_POSITIONS.EggLarvePupeaCare.clone(), parent: 0, room: START_ROOM_RADIUS.brood, role: 'brood', sleepers: 0, fill: 0, via: [] })
    DIG_NETWORK.push({ pos: front.clone(), parent: 0, room: SEARCHING_RADIUS * 0.2, role: null, sleepers: 0, fill: 0, via: [] })
    this.seasonStart = simNow()
    this.updateSeason()
    this.ensureFoodSpots()
    for (let i = 0; i < count; i++) this.born()
    this.ants.forEach((ant) => this.startAnt(ant))
    this.food = this.consumption() * INITIAL_FOOD_MINUTES
    // The founders are not "births per minute".
    this.births0 = this.births
    simSetInterval(() => this.economyTick(), ECONOMY_TICK_MS)
  }

  /** Living ants that have reached the nest at least once. */
  get activeAnts(): number {
    return this.reachedNest.size
  }

  get asleep(): number {
    return this.ants.filter((a) => a.isSleeping).length
  }

  /** Minutes the store would last at the current consumption. */
  get reserveMinutes(): number {
    const c = this.consumption()
    return c > 0 ? this.food / c : Infinity
  }

  /** actual ÷ need, clamped to [0, 1]: how well a task is being kept up. */
  supply(task: TaskName): number {
    const { need, actual } = this.needs[task]
    return need > 0 ? Math.min(1, actual / need) : 1
  }

  // --- births and deaths ---------------------------------------------------

  private born(): Ant {
    const type: AntType = (['P', 'W', 'W', 'W'] as const)[Math.floor(Math.random() * 4)]
    const ant = new Ant(type, this.camera, this.scene)
    ant.data.generation = 1 + Math.floor(simNow() / MEAN_LIFESPAN_MS)
    this.births++
    const needs = this.needs

    ant.setNestCallback = (id: string, task: ActualTask, previousTask: TaskName, addToPreviousTask: number) => {
      this.reachedNest.add(id)
      needs[previousTask].dedicated_ants--
      needs[task.type].dedicated_ants++
      // EXPERIMENTAL frozen ground: digging achieves less when the soil is frozen.
      const work = previousTask === 'Expansion' ? addToPreviousTask * this.digFactor : addToPreviousTask
      needs[previousTask].actual += work
      if (previousTask === 'Expansion') {
        this.expansionWork += work
        this.advanceDiggingFront(work)
      }
      needs.Collect.need += 0.1
      needs.QueenCare.need += 0.05
      // (Brood care no longer gets a bump per delivery: its need comes from the brood.)

      // Food: whatever the ant picked up at its spot arrives now (see forage below).
      if (previousTask === 'Collect') {
        const got = ant.dropCarried()
        this.intakeThisTick += got
        if (got > 0 && Math.random() < 0.06) this.dropDebris('scrap') // crumbs from the meal
      }
      // Soil dug out comes up: one heap of spoil per few digging trips.
      if (previousTask === 'Expansion' && work > 0 && Math.random() < 0.1) this.dropDebris('spoil')

      // Finishing work creates work elsewhere. Routed on `previousTask`, the task that was
      // actually just done, and scaled by how much of it was done, so the two halves of this
      // callback finally agree on which task they are talking about.
      if (work > 0) this.propagate(previousTask, work)

      this.updateUrgencies()
      ant.setNestNeeds = needs
      this.events.delivered?.(previousTask)
    }

    ant.setDisposeCallback = (id: string) => {
      // Mutate in place: every ant's collider holds a reference to this same array.
      const index = this.ants.findIndex((a) => a.data.id === id)
      if (index !== -1) this.ants.splice(index, 1)
      this.reachedNest.delete(id)
      this.deaths++
      // The dead ant no longer works its task. Without this, dedicated_ants only ever grew,
      // iAmOverreacting() saw Collect as over-staffed (267 counted vs 52 real after 35 min),
      // zeroed everyone's Collect rank, and the colony starved next to known food.
      needs[ant.data.behaviour.actualTask.type].dedicated_ants--
      bump(needs.Expansion, -1)
      // An ant that dies in or near the nest is a corpse to carry out; one lost in the field isn't.
      const at = ant.data.body.position
      if (isUnderground(at) || Math.hypot(at.x, at.z) < 1.8 * SEARCHING_RADIUS) this.dropDebris('corpse')
      this.events.died?.(ant.data.body.position)
    }

    // Births now come from the queen (economyTick), not from every adult cloning itself.
    // reproductionOn stays true because the model also gates end-of-life on it.
    ant.setReproductionCallback = () => {}

    // Picking food up at a spot: less per trip the more collectors share the patch, never
    // more than is lying there, and the trip that empties it sends it elsewhere.
    ant.forage = (spot) => {
      const value = INCREASE_MAIN_TASK * ant.data.behaviour.geneticalPriority.Collect
      // What one trip yields follows the environment's richness (season × climate): plentiful
      // seeds in summer, scarce ones in winter. A fixed yield made the seasons run backwards:
      // deficits in spring/summer, a surplus in winter while the colony barely eats.
      const wanted = (FOOD_PER_DELIVERY * value * this.effectiveFood) / (1 + this.collectors / FORAGING_PATCH)
      const taken = Math.min(wanted, spot.remaining)
      spot.remaining -= taken
      if (spot.remaining <= 0) this.respawnFoodSpot(spot)
      return taken
    }
    ant.onKnowledgeShared = (at) => this.events.knowledgeShared?.(at)
    ant.onEncounter = (other) => this.events.encountered?.(ant, other)
    ant.onDump = () => (this.midden += 1)
    // Kept at the old constant (300): nestIsOverreacting compares against it.
    ant.setTotalAnts = WORLD_SCALE
    ant.setReproduction = REPRODUCTION_ON
    needs.Protection.need += type === 'P' ? 0.05 : 0.03
    needs.Exploration.need += type === 'P' ? 0.05 : 0.03
    needs.Expansion.need += type === 'P' ? 0.05 : 0.03
    needs.Collect.need += REPRODUCTION_ON ? 0.1 : 1.0
    needs.Store.need += type === 'P' ? 0.05 : 0.03
    needs.Cleaning.need += type === 'P' ? 0.05 : 0.03
    needs.QueenCare.need += type === 'P' ? 0.5 : 0.1
    this.ants.push(ant)
    return ant
  }

  private startAnt(ant: Ant): void {
    ant.registerCollider(this.ants)
    this.needs[ant.data.behaviour.actualTask.type].dedicated_ants++
    ant.setNestNeeds = this.needs
    ant.live()
  }

  /**
   * Spread the consequences of `amount` work done on `task` across the tasks it affects.
   *
   * The whole amount is distributed: `INFLUENCE_MAIN_SHARE` to the dominant consequence, the
   * remainder split by the declared weights. Two things follow that the old hand-written
   * divisors did not give: every task passes on 100% of its influence (Collect and Expansion
   * used to leak half of theirs into nothing), and the influence is proportional to the work
   * actually done instead of to a fresh `Math.random()` that ignored it.
   */
  private propagate(task: TaskName, amount: number): void {
    const { main, rest } = TASK_INFLUENCE[task]
    bump(this.needs[main], amount * INFLUENCE_MAIN_SHARE)

    const remainder = amount * (1 - INFLUENCE_MAIN_SHARE)
    const weights = Object.entries(rest) as [TaskName, number][]
    const total = weights.reduce((sum, [, w]) => sum + w, 0)
    if (total <= 0) return
    weights.forEach(([t, w]) => bump(this.needs[t], (remainder * w) / total))
  }

  private updateUrgencies(): void {
    ;(Object.keys(this.needs) as TaskName[]).forEach((task) => {
      this.needs[task].urgency = this.needs[task].need / this.needs[task].actual
    })
  }

  // --- food spots --------------------------------------------------------------

  /**
   * A new season: food nobody found has rotted, germinated or been taken by others. Spots no
   * living ant knows are renewed for the new season (new place, new amount, or removed if the
   * season holds fewer). Spots the colony knows stay: a patch being worked doesn't vanish.
   */
  private renewUnknownFoodSpots(): void {
    const known = new Set<FoodSpot>()
    this.ants.forEach((a) => {
      const m = a.foodMemory
      if (m && m.epoch === m.spot.epoch) known.add(m.spot)
    })
    ;[...FOOD_SPOTS].filter((spot) => !known.has(spot)).forEach((spot) => this.respawnFoodSpot(spot, true))
    this.ensureFoodSpots()
  }

  /** Debris appears on the ground just outside the nest entrance. */
  private dropDebris(kind: 'spoil' | 'scrap' | 'corpse'): void {
    if (DEBRIS.length >= DEBRIS_MAX) return
    const a = Math.random() * Math.PI * 2
    const r = SEARCHING_RADIUS * (0.55 + Math.random() * 0.7)
    const x = Math.cos(a) * r
    const z = Math.sin(a) * r
    if (!clearGround(x, z, SEARCHING_RADIUS * 0.05)) return
    DEBRIS.push({ x, z, kind, claimedUntil: 0 })
  }

  /** Refuse on the midden (loads dumped, rotting away slowly). */
  midden = 0
  /** The tunnel network (read by ants and the view). */
  readonly digNetwork = DIG_NETWORK
  /** Exits dug up from the network, besides the nest's own entrance. */
  readonly exits = EXITS
  private digWorkAcc = 0

  /** Digging work banks up; every DIG_WORK_PER_TUNNEL of it opens a new random tunnel. */
  private advanceDiggingFront(work: number): void {
    this.digWorkAcc += work
    while (this.digWorkAcc >= DIG_WORK_PER_TUNNEL) {
      this.digWorkAcc -= DIG_WORK_PER_TUNNEL
      this.digNewTunnel()
    }
  }

  /**
   * A new tunnel and chamber. Many candidates are tried, each growing from a random point of
   * the network in a random direction; any whose chamber would overlap another chamber (dug or
   * built) is discarded, as is anything above ground, outside the territory or below the sleep
   * chamber. Of the rest, the one reaching FARTHEST from the nest wins, so the network keeps
   * pushing outward into free ground. It becomes the digging front.
   */
  private digNewTunnel(): void {
    if (DIG_NETWORK.length >= DIG_NETWORK_MAX) return
    const R = SEARCHING_RADIUS
    const reach = 0.8 * SITE_RADIUS_MAX * this.foodReach
    const built = [TASK_POSITIONS.QueenCare, SLEEP_POSITION]
    let best: { pos: Vector3; parent: number; room: number; far: number; via: Vector3[] } | null = null
    for (let attempt = 0; attempt < 40; attempt++) {
      const parent = Math.floor(Math.random() * DIG_NETWORK.length)
      const from = DIG_NETWORK[parent].pos
      const shaft = Math.random() < DIG_SHAFT_SHARE
      const a = Math.random() * Math.PI * 2
      // A shaft drops and drifts a little sideways; a gallery runs roughly level (slightly down).
      const len = shaft
        ? Math.random() * 0.35 * R
        : DIG_TUNNEL_LENGTH[0] + Math.random() * (DIG_TUNNEL_LENGTH[1] - DIG_TUNNEL_LENGTH[0])
      const dy = shaft
        ? -(DIG_SHAFT_DROP[0] + Math.random() * (DIG_SHAFT_DROP[1] - DIG_SHAFT_DROP[0]))
        : (Math.random() * 0.2 - 0.12) * R
      const x = from.x + Math.cos(a) * len
      const z = from.z + Math.sin(a) * len
      const y = from.y + dy
      if (Math.hypot(x, z) > reach) continue // inside the territory
      if (y > groundAt(x, z) - 0.15 * R || y < -DIG_MAX_DEPTH) continue // underground, not too deep
      // The tunnel wanders: two bends pushed off the straight line, at random.
      const end = new Vector3(x, y, z)
      const span = Vector3.Distance(from, end)
      const via = [1 / 3, 2 / 3].map((t) =>
        Vector3.Lerp(from, end, t).add(
          new Vector3(Math.random() - 0.5, (Math.random() - 0.5) * (shaft ? 1 : 0.4), Math.random() - 0.5).scale(2 * DIG_WANDER * span),
        ),
      )
      // Shafts end in a small junction; galleries mostly in a small chamber, now and then a large one.
      const room = shaft
        ? R * (0.12 + Math.random() * 0.08)
        : R * (Math.random() < 0.3 ? 0.3 + Math.random() * 0.15 : 0.15 + Math.random() * 0.1)
      const clear = (c: Vector3, r: number): boolean => Math.hypot(c.x - x, c.y - y, c.z - z) >= room + r + 0.1 * R
      if (!built.every((c) => clear(c, 0.45 * R))) continue // no overlap with the built chambers
      if (!DIG_NETWORK.every((n) => clear(n.pos, n.room))) continue // nor with any dug one
      // The whole tunnel must stay underground, also where the ground dips between its ends.
      const line = [from, ...via, end]
      let buried = true
      for (let seg = 1; seg < line.length && buried; seg++) {
        for (let k = 1; k <= 4 && buried; k++) {
          const p = Vector3.Lerp(line[seg - 1], line[seg], k / 4)
          if (p.y > groundAt(p.x, p.z) - 0.1 * R && Math.hypot(p.x, p.z) > 1) buried = false
        }
      }
      if (!buried) continue
      // Push for open ground: as far from the rest of the nest as possible, and outwards, with
      // some randomness (real digging is not optimal). Deeper is harder (real nests have most
      // of their chambers near the top and thin out with depth).
      // Vertical room counts more: the nest is as deep as it is wide, the territory much wider.
      const open = Math.min(...DIG_NETWORK.map((n) => Math.hypot(n.pos.x - x, (n.pos.y - y) * DIG_VERTICAL_ROOM, n.pos.z - z)))
      const far = (open + 0.15 * Math.hypot(x, z)) * Math.exp(-Math.abs(y) / DIG_DEPTH_SCALE) * (0.6 + 0.8 * Math.random())
      if (!best || far > best.far) best = { pos: end, parent, room, far, via }
    }
    if (!best) return // no free ground this time: the front stays where it is
    DIG_NETWORK.push({ pos: best.pos, parent: best.parent, room: best.room, role: null, sleepers: 0, fill: 0, via: best.via })
    TASK_POSITIONS.Expansion.copyFrom(best.pos)
    this.maybeDigExit(DIG_NETWORK.length - 1)
  }

  /** A shallow tip far from the nest (and from other exits) may be dug up into a new exit. */
  private maybeDigExit(node: number): void {
    if (EXITS.length >= EXITS_MAX || Math.random() > EXIT_CHANCE) return
    const p = DIG_NETWORK[node].pos
    const ground = groundAt(p.x, p.z)
    if (ground - p.y > EXIT_MAX_DEPTH) return
    if (Math.hypot(p.x, p.z) < EXIT_MIN_FROM_NEST) return
    if (!clearGround(p.x, p.z, EXIT_RADIUS)) return // the crater on dry, open ground
    // Not on a food spot or the midden either.
    if (FOOD_SPOTS.some((f) => Math.hypot(f.position.x - p.x, f.position.z - p.z) < FOOD_SPOT_RADIUS + EXIT_RADIUS)) return
    if (Math.hypot(TASK_POSITIONS.Cleaning.x - p.x, TASK_POSITIONS.Cleaning.z - p.z) < MIDDEN_RADIUS + EXIT_RADIUS) return
    if (EXITS.some((e) => Math.hypot(e.surface.x - p.x, e.surface.z - p.z) < EXIT_MIN_APART)) return
    // Only a fairly direct tunnel is worth opening up: one that winds far more than the walk
    // over the ground would never be taken.
    const path = digPathTo(node)
    let tunnel = ground - p.y
    for (let i = 1; i < path.length; i++) tunnel += Vector3.Distance(path[i - 1], path[i])
    if (tunnel > Math.hypot(p.x, p.z) * EXIT_MAX_WINDING) return
    EXITS.push({ node, surface: new Vector3(p.x, ground, p.z) })
    this.events.exitDug?.(EXITS[EXITS.length - 1].surface)
  }

  /**
   * Room roles. For each role the overflow (what the main room can't hold) is compared with
   * the capacity of the dug rooms already given that role: short of space → the free room
   * nearest the main room takes the role; plenty to spare → an empty room is freed again.
   * Brood and food overflow are then shared out over their rooms, in the order they were taken.
   */
  private allocateRooms(): void {
    // Brood and food go in the founding chamber first; sleepers in the main sleep chamber.
    const first: Record<RoomRole, number> = { sleep: ROOM_UNIT_HOLDS.sleep, brood: FOUNDING_HOLDS.brood, store: FOUNDING_HOLDS.store }
    const demand: Record<RoomRole, number> = { sleep: this.asleep, brood: this.brood.length, store: Math.max(0, this.food) }
    FOUNDING.brood = Math.min(demand.brood, first.brood)
    FOUNDING.store = Math.min(demand.store, first.store)
    const queen = TASK_POSITIONS.QueenCare
    ;(Object.keys(demand) as RoomRole[]).forEach((role) => {
      const overflow = Math.max(0, demand[role] - first[role])
      const rooms = DIG_NETWORK.filter((n) => n.role === role)
      const capacity = rooms.reduce((sum, n) => sum + roomCapacity(n, role), 0)
      const used = (n: DigNode): number => (role === 'sleep' ? n.sleepers : n.fill)
      if (overflow > capacity) {
        // Short of space: the free room nearest the rooms already used this way (or the
        // founding / sleep chamber) takes the role.
        const near = rooms.length > 0 ? rooms.map((n) => n.pos) : [role === 'sleep' ? SLEEP_POSITION : queen]
        let best: DigNode | null = null
        let bestD = Infinity
        DIG_NETWORK.forEach((n) => {
          if (n.parent < 0 || n.role !== null || n.room <= 0) return
          const d = Math.min(...near.map((p) => Vector3.Distance(n.pos, p)))
          if (d < bestD) {
            bestD = d
            best = n
          }
        })
        if (best) (best as DigNode).role = role
      } else {
        // Free the last-taken empty room if the others would still hold the overflow with room to spare.
        const spare = [...rooms].reverse().find((n) => used(n) === 0 && overflow <= (capacity - roomCapacity(n, role)) * 0.7)
        if (spare) spare.role = null
      }
      const housed = DIG_NETWORK.filter((n) => n.role === role).reduce((sum, n) => sum + roomCapacity(n, role), 0)
      this.roomSpace[role] = first[role] + housed
      this.unhoused[role] = Math.max(0, overflow - housed)
      if (role === 'sleep') return
      let left = overflow
      let busiest: DigNode | null = null
      DIG_NETWORK.forEach((n) => {
        if (n.role !== role) return
        n.fill = Math.min(left, roomCapacity(n, role))
        left -= n.fill
        if (!busiest || n.fill > busiest.fill) busiest = n
      })
      // Storers and brood carers head for the room that holds the most (walkers hold copies).
      const site = role === 'store' ? TASK_POSITIONS.Store : TASK_POSITIONS.EggLarvePupeaCare
      const b = busiest as DigNode | null
      site.copyFrom(b && b.fill > FOUNDING[role] ? b.pos : queen)
    })
  }

  /** How much of the food, brood and sleepers has no room: 0..1 each, summed (0..3). */
  get crowding(): number {
    const share = (role: RoomRole, total: number): number => (total > 0 ? this.unhoused[role] / total : 0)
    return share('sleep', this.asleep) + share('brood', this.brood.length) + share('store', Math.max(0, this.food))
  }

  /** Keep the patrol band in step with the territory: from outside the nest to 60% of the fence. */
  private updatePatrolBand(): void {
    PATROL_BAND.inner = 1.5 * SEARCHING_RADIUS
    PATROL_BAND.outer = Math.max(PATROL_BAND.inner + SEARCHING_RADIUS, 0.6 * SITE_RADIUS_MAX * this.foodReach)
  }

  /** Everything already on the map that a new spot should keep its distance from. */
  private occupied(except?: FoodSpot): Vector3[] {
    return [
      ...(Object.keys(TASK_POSITIONS) as TaskName[]).filter((t) => t !== 'Collect').map((t) => TASK_POSITIONS[t]),
      ...FOOD_SPOTS.filter((spot) => spot !== except).map((spot) => spot.position),
      ...EXITS.map((e) => e.surface),
    ]
  }

  /** A random direction, so spots surround the nest instead of sharing one octant. */
  /**
   * Food lies on the ground, anywhere in the territory (inside the perimeter fence), spread
   * evenly over its area. The INNER edge stays fixed: food keeps turning up near the nest as the
   * territory grows. (It used to scale with expansion too, so a grown colony only ever found
   * food far away; once walking made distance cost time, that starved it year after year.)
   */
  private placeFood(except?: FoodSpot): Vector3 {
    // Never on the anthill: clear of the mound as it is now, with room for the spot itself.
    const minR = Math.max(0.6 * SEARCHING_RADIUS, (this.nestDiameter / 2) * NEST_CLEARING + FOOD_SPOT_RADIUS)
    return placeOnSurface(this.occupied(except), minR, SITE_RADIUS_MAX * this.foodReach, FOOD_SPOT_RADIUS)
  }

  /** Keep the number of spots in line with the size of the foraging area. */
  /** How rich the environment is from now on. Richer takes effect at once; poorer as spots run out. */
  setFoodAvailability(value: number): void {
    this.foodAvailability = Math.max(0.05, value)
    this.ensureFoodSpots()
  }

  /** Food richness actually in effect: the slider (climate baseline) × the season. */
  get effectiveFood(): number {
    return this.foodAvailability * this.season.food
  }

  /** Index of the season in effect now. */
  get seasonIndex(): number {
    return Math.max(0, SEASONS.findIndex((s) => s.name === this.season.name))
  }

  /**
   * Cycle on: carry on turning from the current season. Cycle off: hold the current season
   * with all its factors (food, eating, laying, rest) until told otherwise.
   */
  setSeasonMode(mode: SeasonMode): void {
    const index = this.seasonIndex
    this.seasonMode = mode
    if (mode === 'hold') this.heldSeason = index
    else this.seasonStart = simNow() - index * (YEAR_MS / SEASONS.length)
    this.updateSeason()
    this.ensureFoodSpots()
  }

  /** Jump to a season: cycling carries on from its start; holding stays in it. */
  setSeason(index: number): void {
    const i = ((index % SEASONS.length) + SEASONS.length) % SEASONS.length
    if (this.seasonMode === 'hold') this.heldSeason = i
    else this.seasonStart = simNow() - i * (YEAR_MS / SEASONS.length)
    this.updateSeason()
    this.ensureFoodSpots()
  }

  /** Blend the current season's factors into the next one over the last SEASON_BLEND of it. */
  private updateSeason(): void {
    const previous = this.season.name
    if (this.seasonMode === 'hold') {
      const held = SEASONS[this.heldSeason]
      this.season = {
        ...held,
        progress: 0,
        tint: [...held.tint] as [number, number, number],
        ground: [...held.ground] as [number, number, number],
      }
    } else {
      const seasonLength = YEAR_MS / SEASONS.length
      const t = (((simNow() - this.seasonStart) % YEAR_MS) + YEAR_MS) % YEAR_MS
      const index = Math.floor(t / seasonLength)
      const progress = (t - index * seasonLength) / seasonLength
      const now = SEASONS[index]
      const next = SEASONS[(index + 1) % SEASONS.length]
      const k = Math.max(0, (progress - (1 - SEASON_BLEND)) / SEASON_BLEND)
      const mix = (a: number, b: number): number => a + (b - a) * k
      this.season = {
        name: now.name,
        progress,
        food: mix(now.food, next.food),
        eat: mix(now.eat, next.eat),
        lay: mix(now.lay, next.lay),
        rest: mix(now.rest, next.rest),
        spoil: mix(now.spoil, next.spoil),
        aging: mix(now.aging, next.aging),
        frost: mix(now.frost, next.frost),
        tint: [mix(now.tint[0], next.tint[0]), mix(now.tint[1], next.tint[1]), mix(now.tint[2], next.tint[2])],
        // The soil changes slowly: it blends across the WHOLE season (eased), not just its end.
        ground: ((): [number, number, number] => {
          const e = progress * progress * (3 - 2 * progress)
          const g = (i: number): number => now.ground[i] + (next.ground[i] - now.ground[i]) * e
          return [g(0), g(1), g(2)]
        })(),
      }
    }
    setRestFactor(this.season.rest)
    if (this.season.name !== previous && this.season.name !== 'None') {
      if (previous !== 'None') this.renewUnknownFoodSpots()
      this.events.seasonChanged?.(this.season.name)
    }
  }

  private rollSpotAmount(): number {
    return rollFoodAmount() * this.effectiveFood
  }

  private ensureFoodSpots(): void {
    const target = foodSpotTarget(this.foodReach, this.effectiveFood)
    while (FOOD_SPOTS.length < target) {
      const amount = this.rollSpotAmount()
      FOOD_SPOTS.push({ id: this.nextSpotId++, epoch: 0, position: this.placeFood(), remaining: amount, initial: amount })
    }
  }

  /**
   * The spot is empty: it reappears elsewhere with a new amount and a new epoch. Nobody is
   * told. Ants that remember it walk to the old place, find nothing, and forget it; only
   * this spot's users are affected, the rest of the colony keeps foraging its own spots.
   * The position is mutated in place (the view follows the object); ants hold copies.
   */
  private respawnFoodSpot(spot: FoodSpot, seasonal = false): void {
    // A poorer environment than the ground currently shows: this spot is not replaced.
    // Its epoch still changes, so every memory of it goes stale like any emptied spot.
    if (FOOD_SPOTS.length > foodSpotTarget(this.foodReach, this.effectiveFood)) {
      spot.epoch++
      spot.remaining = 0
      FOOD_SPOTS.splice(FOOD_SPOTS.indexOf(spot), 1)
      if (!seasonal) {
        this.foodSitesDepleted++
        this.events.foodSiteMoved?.(spot.position, 0)
      }
      return
    }
    spot.position.copyFrom(this.placeFood(spot))
    spot.initial = this.rollSpotAmount()
    spot.remaining = spot.initial
    spot.epoch++
    // Seasonal renewal is not "a spot ran out": no depletion count, no notification.
    if (!seasonal) {
      this.foodSitesDepleted++
      this.events.foodSiteMoved?.(spot.position, spot.initial)
    }
  }

  // --- economy ---------------------------------------------------------------

  private consumption(): number {
    const adults = this.ants.reduce((sum, a) => sum + FOOD_PER_ANT_PER_MIN[a.data.type], 0)
    // Larvae eat too.
    return (adults + this.brood.length * BROOD_FOOD_PER_MIN) * this.season.eat
  }

  /**
   * dedicated_ants is maintained incrementally (born, switched, died); re-derive it from the
   * living ants each tick so no future bookkeeping slip can drift it away from reality again.
   * The model reads it as "how many ants are on this task", so the truth is the right value.
   */
  private resyncDedicatedAnts(): void {
    ;(Object.keys(this.needs) as TaskName[]).forEach((t) => (this.needs[t].dedicated_ants = 0))
    this.ants.forEach((a) => this.needs[a.data.behaviour.actualTask.type].dedicated_ants++)
  }

  private economyTick(): void {
    const dtMin = ECONOMY_TICK_MS / 60e3
    // Ants age at the season's pace (slower in the cold).
    this.ants.forEach((ant) => (ant.age += ECONOMY_TICK_MS * this.season.aging))
    // Trails fade: routes nobody walks disappear, walked ones are kept up by the walking.
    if (TRAILS_ON) TRAILS.decay(ECONOMY_TICK_MS, TRAIL_HALF_LIFE_MS)
    if (NO_ENTRY_ON) TRAILS.decayNoEntry(ECONOMY_TICK_MS, NO_ENTRY_HALF_LIFE_MS)
    this.updateSeason()
    this.ensureFoodSpots()
    this.updatePatrolBand()
    this.allocateRooms()
    this.midden *= Math.pow(0.5, ECONOMY_TICK_MS / MIDDEN_HALF_LIFE_MS)
    this.collectors = this.ants.filter((a) => a.data.behaviour.actualTask.type === 'Collect').length
    this.resyncDedicatedAnts()

    // Forget slowly, on both sides of the ratio.
    //
    // `need` and `actual` were running totals, so `urgency = need / actual` converged to the
    // colony's lifetime average and stopped moving: the same +1 need spike shifted urgency by
    // 0.167 after ten deliveries and by 0.00003 after sixty thousand. The colony went deaf.
    // Decaying both turns urgency into a ratio of RECENT rates, so a spike lands with the same
    // weight at minute one and at hour three. The floor under `actual` stops a task nobody has
    // touched from dividing its way to an infinite urgency.
    const keep = Math.pow(0.5, dtMin / NEED_HALF_LIFE_MIN)
    ;(Object.keys(this.needs) as TaskName[]).forEach((t) => {
      const n = this.needs[t]
      n.need *= keep
      n.actual = Math.max(NEED_ACTUAL_FLOOR, n.actual * keep)
    })

    // In: this tick's Collect deliveries.
    this.food += this.intakeThisTick
    this.intakePerMin = smooth(this.intakePerMin, this.intakeThisTick / dtMin)
    this.intakeThisTick = 0

    // Out: spoilage (Store work keeps it down) and everyone eating.
    // Food with no store room to go in lies in the tunnels and spoils fast, Store work or not.
    const unstored = Math.min(this.unhoused.store, Math.max(0, this.food))
    const spoiled =
      (this.food - unstored) * SPOILAGE_PER_MIN * this.season.spoil * (1 - this.supply('Store')) * dtMin +
      unstored * UNSTORED_SPOIL_PER_MIN * this.season.spoil * dtMin
    const eaten = this.consumption() * dtMin
    this.spoilagePerMin = smooth(this.spoilagePerMin, spoiled / dtMin)
    this.consumptionPerMin = smooth(this.consumptionPerMin, eaten / dtMin)
    this.food -= spoiled + eaten

    // Empty store: some ants starve.
    if (this.food < 0 && this.brood.length > 0) {
      // Famine: the colony eats its brood first (as real colonies do), recovering part of the
      // food each egg cost. Rate-limited, so a short dip doesn't wipe the whole brood.
      this.broodEatProgress += this.brood.length * BROOD_CANNIBALISM_PER_MIN * dtMin
      while (this.broodEatProgress >= 1 && this.brood.length > 0 && this.food < 0) {
        this.broodEatProgress -= 1
        this.brood.pop()
        this.broodEaten++
        this.food += EGG_FOOD_COST * BROOD_CANNIBALISM_RETURN
      }
    }
    if (this.food < 0) {
      this.food = 0
      // Accumulate fractional deaths like the queen's eggs. Math.ceil per 1s tick meant at
      // least one death EVERY tick: a flat 60/min whatever the colony size (10× the intended
      // 10%/min for 100 ants), which is what turned a lean spell into a wipe-out.
      this.starveProgress += this.ants.length * STARVATION_DEATHS_PER_MIN * dtMin
      while (this.starveProgress >= 1 && this.ants.length > 0) {
        this.starveProgress -= 1
        this.starved++
        this.ants[Math.floor(Math.random() * this.ants.length)].dispose()
      }
    } else {
      this.starveProgress = 0
    }

    // Hunger feedback: a thin reserve raises the colony's need to forage.
    if (HUNGER_FEEDBACK) {
      const hunger = Math.max(0, 1 - this.reserveMinutes / HUNGER_TARGET_RESERVE_MIN)
      this.needs.Collect.need += hunger * HUNGER_COLLECT_NEED_PER_MIN * dtMin
      if (hunger > 0) this.updateUrgencies()
    }

    // Two pressures the colony's own state creates, rather than ant interactions:
    //
    //   Store:    food already home has to go somewhere, so a fuller reserve needs more
    //             storing. This is what stops a big haul from simply sitting in the open
    //             and spoiling: intake raises the need to store it.
    //   Cleaning: a bigger colony in a bigger nest makes more mess. Both terms matter:
    //             ants generate it, and the dug-out area is what has to be walked.
    this.needs.Store.need += this.food * STORE_NEED_PER_FOOD_PER_MIN * dtMin
    const nestFactor = this.nestDiameter / NEST_BASE_DIAMETER
    this.needs.Cleaning.need += this.ants.length * nestFactor * CLEANING_NEED_PER_ANT_PER_MIN * dtMin
    // Digging follows crowding: food, brood and sleepers with no room make the need to dig.
    this.needs.Expansion.need += this.crowding * EXPANSION_CROWDING_NEED_PER_MIN * dtMin
    this.updateUrgencies()

    // Exterior work is dangerous: predators, heat, getting lost. Only awake ants out on
    // an exterior task are exposed, which is what makes foragers die younger.
    const exposed = this.ants.filter(
      (a) => !a.isSleeping && EXTERIOR_TASKS.includes(a.data.behaviour.actualTask.type),
    )
    exposed.forEach((a) => {
      if (Math.random() < EXTERIOR_HAZARD_PER_MIN * dtMin) {
        this.diedOutside++
        a.dispose()
      }
    })

    this.broodTick(dtMin)
    this.queenTick(dtMin)

    const k = dtMin / RATE_WINDOW_MIN
    this.birthsPerMin += ((this.births - this.births0) / dtMin - this.birthsPerMin) * k
    this.deathsPerMin += ((this.deaths - this.deaths0) / dtMin - this.deathsPerMin) * k
    this.births0 = this.births
    this.deaths0 = this.deaths
  }

  /**
   * How deep the nest has been dug, for the VIEW only (galleries drawn under the nest as it
   * expands). The digging front ants walk to does not move: that would change their behaviour.
   */
  get digDepth(): number {
    return SEARCHING_RADIUS * (DIG_DEPTH_START + DIG_DEPTH_RANGE * this.expansionLevel)
  }

  /**
   * Digging effect left on frozen ground (EXPERIMENT_FROZEN_GROUND). The same at every depth:
   * letting deep digging escape the frost made the territory expand faster, spread food out
   * sooner and cost the colony (headless A/B), so the winter slowdown stays whole.
   */
  get digFactor(): number {
    return EXPERIMENT_FROZEN_GROUND ? 1 - FROST_DIG_LOSS * this.season.frost : 1
  }

  /** Brood-care supply, 0..1: how well the brood is being looked after. */
  get broodCare(): number {
    return this.supply('EggLarvePupeaCare')
  }

  /**
   * Brood develops, asks for care, and some of it dies if neglected. Its care NEED is
   * proportional to how much brood there is, so brood care follows the eggs laid: high in a
   * spring brood boom, near zero in winter when the queen barely lays.
   */
  private broodTick(dtMin: number): void {
    const n = this.brood.length
    this.needs.EggLarvePupeaCare.need += n * BROOD_CARE_NEED_PER_MIN * dtMin
    if (n === 0) return
    // Brood with no nursery room is crowded in and cared for worse.
    const housed = 1 - Math.min(1, this.unhoused.brood / n)
    const care = this.broodCare * (housed + (1 - housed) * UNHOUSED_BROOD_CARE)
    // Well tended: full speed. Neglected: down to a quarter speed.
    const step = ((dtMin * 60e3) / BROOD_DEV_MS) * (0.25 + 0.75 * care)
    // Neglect kills: (1 − care)² so a slightly short-handed nursery loses little.
    this.broodDeathProgress += n * BROOD_NEGLECT_DEATHS_PER_MIN * (1 - care) * (1 - care) * dtMin
    while (this.broodDeathProgress >= 1 && this.brood.length > 0) {
      this.broodDeathProgress -= 1
      this.brood.splice(Math.floor(Math.random() * this.brood.length), 1)
      this.broodDied++
    }
    for (let i = this.brood.length - 1; i >= 0; i--) {
      const b = this.brood[i]
      b.progress += step
      if (b.progress >= 1) {
        this.brood.splice(i, 1)
        this.broodEmerged++
        this.startAnt(this.born())
        this.events.born?.()
      }
    }
  }

  private queenTick(dtMin: number): void {
    if (!REPRODUCTION_ON) {
      this.layRate = 0
      this.layLimit = 'none'
      return
    }
    const reserve = this.reserveMinutes
    const foodFactor = Number.isFinite(reserve) ? reserve / (reserve + QUEEN_FOOD_HALF_RESERVE_MIN) : 1
    // A neglected queen still lays, slowly.
    const careFactor = 0.25 + 0.75 * this.supply('QueenCare')
    const atCap = this.ants.length + this.brood.length >= POPULATION_CAP
    this.layRate = atCap ? 0 : QUEEN_EGGS_PER_MIN_MAX * foodFactor * careFactor * this.season.lay
    this.layLimit = atCap ? 'cap' : foodFactor < careFactor ? 'food' : careFactor < 1 ? 'care' : 'none'

    this.eggProgress += this.layRate * dtMin
    while (this.eggProgress >= 1 && this.food >= EGG_FOOD_COST && this.ants.length + this.brood.length < POPULATION_CAP) {
      this.eggProgress -= 1
      this.food -= EGG_FOOD_COST
      this.brood.push({ progress: 0 }) // an egg, not an ant yet
    }
    if (this.food < EGG_FOOD_COST) this.eggProgress = Math.min(this.eggProgress, 1)
  }
}
