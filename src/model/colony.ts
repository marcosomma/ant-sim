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
  FOOD_AVAILABILITY,
  FOOD_SPOTS,
  FoodSpot,
  INCREASE_MAIN_TASK,
  foodSpotTarget,
  placeInOctant,
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
  private nextSpotId = 0
  /** Spots exhausted so far, purely for the HUD. */
  foodSitesDepleted = 0

  private readonly reachedNest = new Set<string>()
  private collectors = 0
  /** Total Expansion work ever banked. Never decays: a dug chamber stays dug. */
  private expansionWork = 0
  private intakeThisTick = 0
  private eggProgress = 0
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
      needs[previousTask].actual += addToPreviousTask
      if (previousTask === 'Expansion') this.expansionWork += addToPreviousTask
      needs.Collect.need += 0.1
      needs.QueenCare.need += 0.05
      needs.EggLarvePupeaCare.need += 0.05

      // Food: whatever the ant picked up at its spot arrives now (see forage below).
      if (previousTask === 'Collect') this.intakeThisTick += ant.dropCarried()

      // Finishing work creates work elsewhere. Routed on `previousTask`, the task that was
      // actually just done, and scaled by how much of it was done, so the two halves of this
      // callback finally agree on which task they are talking about.
      if (addToPreviousTask > 0) this.propagate(previousTask, addToPreviousTask)

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
      this.events.died?.(ant.data.body.position)
    }

    // Births now come from the queen (economyTick), not from every adult cloning itself.
    // reproductionOn stays true because the model also gates end-of-life on it.
    ant.setReproductionCallback = () => {}

    // Picking food up at a spot: less per trip the more collectors share the patch, never
    // more than is lying there, and the trip that empties it sends it elsewhere.
    ant.forage = (spot) => {
      const value = INCREASE_MAIN_TASK * ant.data.behaviour.geneticalPriority.Collect
      const wanted = (FOOD_PER_DELIVERY * value) / (1 + this.collectors / FORAGING_PATCH)
      const taken = Math.min(wanted, spot.remaining)
      spot.remaining -= taken
      if (spot.remaining <= 0) this.respawnFoodSpot(spot)
      return taken
    }
    ant.onKnowledgeShared = (at) => this.events.knowledgeShared?.(at)
    ant.onEncounter = (other) => this.events.encountered?.(ant, other)
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
    needs.EggLarvePupeaCare.need += type === 'P' ? 0.5 : 0.25
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

  /** Everything already on the map that a new spot should keep its distance from. */
  private occupied(except?: FoodSpot): Vector3[] {
    return [
      ...(Object.keys(TASK_POSITIONS) as TaskName[]).filter((t) => t !== 'Collect').map((t) => TASK_POSITIONS[t]),
      ...FOOD_SPOTS.filter((spot) => spot !== except).map((spot) => spot.position),
    ]
  }

  /** A random direction, so spots surround the nest instead of sharing one octant. */
  private placeFood(except?: FoodSpot): Vector3 {
    const sign = (): number => (Math.random() < 0.5 ? -1 : 1)
    return placeInOctant([sign(), sign(), sign()], this.occupied(except), this.foodReach)
  }

  /** Keep the number of spots in line with the size of the foraging area. */
  /** How rich the environment is from now on. Richer takes effect at once; poorer as spots run out. */
  setFoodAvailability(value: number): void {
    this.foodAvailability = Math.max(0.05, value)
    this.ensureFoodSpots()
  }

  private rollSpotAmount(): number {
    return rollFoodAmount() * this.foodAvailability
  }

  private ensureFoodSpots(): void {
    const target = foodSpotTarget(this.foodReach, this.foodAvailability)
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
  private respawnFoodSpot(spot: FoodSpot): void {
    // A poorer environment than the ground currently shows: this spot is not replaced.
    // Its epoch still changes, so every memory of it goes stale like any emptied spot.
    if (FOOD_SPOTS.length > foodSpotTarget(this.foodReach, this.foodAvailability)) {
      spot.epoch++
      spot.remaining = 0
      FOOD_SPOTS.splice(FOOD_SPOTS.indexOf(spot), 1)
      this.foodSitesDepleted++
      this.events.foodSiteMoved?.(spot.position, 0)
      return
    }
    spot.position.copyFrom(this.placeFood(spot))
    spot.initial = this.rollSpotAmount()
    spot.remaining = spot.initial
    spot.epoch++
    this.foodSitesDepleted++
    this.events.foodSiteMoved?.(spot.position, spot.initial)
  }

  // --- economy ---------------------------------------------------------------

  private consumption(): number {
    return this.ants.reduce((sum, a) => sum + FOOD_PER_ANT_PER_MIN[a.data.type], 0)
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
    this.ensureFoodSpots()
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
    const spoiled = this.food * SPOILAGE_PER_MIN * (1 - this.supply('Store')) * dtMin
    const eaten = this.consumption() * dtMin
    this.spoilagePerMin = smooth(this.spoilagePerMin, spoiled / dtMin)
    this.consumptionPerMin = smooth(this.consumptionPerMin, eaten / dtMin)
    this.food -= spoiled + eaten

    // Empty store: some ants starve.
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

    this.queenTick(dtMin)

    const k = dtMin / RATE_WINDOW_MIN
    this.birthsPerMin += ((this.births - this.births0) / dtMin - this.birthsPerMin) * k
    this.deathsPerMin += ((this.deaths - this.deaths0) / dtMin - this.deathsPerMin) * k
    this.births0 = this.births
    this.deaths0 = this.deaths
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
    const atCap = this.ants.length >= POPULATION_CAP
    this.layRate = atCap ? 0 : QUEEN_EGGS_PER_MIN_MAX * foodFactor * careFactor
    this.layLimit = atCap ? 'cap' : foodFactor < careFactor ? 'food' : careFactor < 1 ? 'care' : 'none'

    this.eggProgress += this.layRate * dtMin
    while (this.eggProgress >= 1 && this.food >= EGG_FOOD_COST && this.ants.length < POPULATION_CAP) {
      this.eggProgress -= 1
      this.food -= EGG_FOOD_COST
      this.startAnt(this.born())
      this.events.born?.()
    }
    if (this.food < EGG_FOOD_COST) this.eggProgress = Math.min(this.eggProgress, 1)
  }
}
