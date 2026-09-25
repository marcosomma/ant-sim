import {
  AbstractMesh,
  Animation,
  ArcRotateCamera,
  Color3,
  Nullable,
  Observer,
  Scene,
  StandardMaterial,
  Vector3,
} from '@babylonjs/core'

import { createSphere } from '../commons/meshCreator'
import { SimTimer, simClearTimer, simNow, simSetInterval, simSetTimeout } from '../commons/simClock'
import {
  ANT_INFLUENCE_FACTOR,
  ENCOUNTER_COOLDOWN_MS,
  ENCOUNTER_HALF_LIFE_MS,
  ENCOUNTER_PRIOR,
  SWITCH_MODEL,
  SWITCH_THRESHOLD_BASE,
  SWITCH_THRESHOLD_SPREAD,
  getLifespan,
  ActualTask,
  AntData,
  AntType,
  AUTODISCOVERING,
  DISCOVER_ALONG_PATH,
  FOOD_NEWS_FRESH_MS,
  FOOD_SPOTS,
  FoodSpot,
  foodSpotNear,
  CHECK_TIME_INTERVAL,
  DisposeCallback,
  INCREASE_MAIN_TASK,
  WORLD_SCALE,
  MIN_CHECK_TIME_INTERVAL,
  NEG_DISCOVERED_TARGET_MATCH,
  NEG_TARGET_MATCH,
  NestCallback,
  NestNeeds,
  POS_DISCOVERED_TARGET_MATCH,
  POS_TARGET_MATCH,
  ReproductionCallback,
  RankTasks,
  SLEEP_CHAMBER_RADIUS,
  SLEEP_POSITION,
  TASK_POSITIONS,
  TASKS,
  TaskName,
  getAntObject,
  getDecreaseInterval,
  getNapDuration,
  getPerformTaskInterval,
  getRandomTarget,
  getReproductionTime,
  getSleepingInterval,
} from '../constants'

export default class Ant {
  data: AntData
  reportedCollision = false
  isSleeping = false
  awakeTime: SimTimer | null = null
  checkTaskInterval: SimTimer | null = null
  sleep: SimTimer | null = null
  decreaseTaskInterval: SimTimer | null = null
  collider: Nullable<Observer<Scene>> = null
  // Visual hook: fired when an encounter teaches either ant a task location.
  onKnowledgeShared?: (at: Vector3) => void
  // Visual hook: fired for every counted (cooldown-deduped) encounter.
  onEncounter?: (other: Ant) => void

  // --- food spots ---
  /**
   * The one food spot this ant believes in, with the epoch and position it learned. May be
   * stale (the spot was emptied and respawned elsewhere); the ant only finds out on arrival.
   * discoveredPositions.Collect mirrors `foodMemory !== null`.
   */
  foodMemory: { spot: FoodSpot; epoch: number; at: Vector3; confirmedAt: number } | null = null
  /**
   * Spots this ant has seen empty, by the epoch it found dead. Negative knowledge travels
   * like positive: the ant won't relearn a dead spot, and corrects nestmates who still
   * believe in it. Without it, 47% of learned food memories were already stale (headless).
   */
  private knownEmpty = new Map<FoodSpot, number>()
  /** Food picked up at a spot and not yet delivered to the nest. */
  carried = 0
  /** Set by the Colony: take food from a spot, returns the amount actually picked up. */
  forage?: (spot: FoodSpot) => number

  // --- threshold switching (SWITCH_MODEL = 'threshold') ---
  /** Fading tally of distinct encounters, by the task the other ant was doing. */
  private encounterTally = {} as Record<TaskName, number>
  private tallyUpdatedAt = 0
  private lastMet = new Map<string, number>()
  /** Individual response thresholds, fixed at birth. */
  private thresholds = {} as Record<TaskName, number>

  constructor(type: AntType, camera: ArcRotateCamera, scene: Scene) {
    const ant = getAntObject(type)
    const randomColor = new Color3(Math.random(), Math.random(), Math.random())
    ant.reproductionTime = getReproductionTime()
    // Was floor(random·-r + r) + r with r uniform from 0: lifespans from ~0 up. See getLifespan.
    ant.lifeTime = getLifespan()
    ant.babylonElements = { scene, camera }
    ant.body = createSphere(
      { id: ant.id, name: `${type} - ${ant.id}` },
      type === 'W' ? WORLD_SCALE / 2e2 : WORLD_SCALE / 125,
      12,
      randomColor,
      camera,
      scene,
    )
    ant.body.position = new Vector3(0, 0, 0)
    const material = new StandardMaterial(`ant:${type} - ${ant.id}`, scene)
    material.diffuseColor = randomColor
    ant.body.material = material

    this.data = ant
    ;(Object.keys(ant.behaviour.geneticalPriority) as TaskName[]).forEach((task) => {
      this.encounterTally[task] = 0
      // Eager ants (geneticalPriority → 2) have low thresholds; a Gaussian-ish log-normal
      // jitter keeps two ants with the same genetics from switching in lockstep.
      const gaussian = (Math.random() + Math.random() + Math.random() - 1.5) * 2
      this.thresholds[task] =
        SWITCH_THRESHOLD_BASE * (2 / ant.behaviour.geneticalPriority[task]) * Math.exp(SWITCH_THRESHOLD_SPREAD * gaussian)
    })
    this.setTarget = this.targetFor(ant.behaviour.actualTask.type)
    this.setNest = new Vector3(0, 0, 0)
  }

  private between(x: number, min: number, max: number): boolean {
    return x >= min && x <= max
  }

  set setNestCallback(cb: NestCallback) {
    this.data.nestCallback = (id, actualTask, previousTask, addedValue) => cb(id, actualTask, previousTask, addedValue)
  }

  set setReproductionCallback(cb: ReproductionCallback) {
    this.data.reproductionCallback = () => cb(this.data.id)
  }

  set setDisposeCallback(cb: DisposeCallback) {
    this.data.disposeCallback = () => cb(this.data.id)
  }

  set setNestNeeds(needs: NestNeeds) {
    const ranks = this.data.behaviour.rankTasks as Record<TaskName, number>
      ; (Object.keys(needs) as TaskName[]).forEach((task) => {
        if (!ranks[task]) ranks[task] = this.data.behaviour.geneticalPriority[task] * needs[task].urgency
      })
    this.data.nestNeeds = needs
  }

  set setTarget(target: Vector3) {
    // Copy, never alias. TASK_POSITIONS entries are mutated in place when a site moves
    // (the food spot respawns), and the walk animation interpolates towards this exact
    // object every frame. Aliased, every ant heading for the old spot was dragged along its
    // path to the new one and "discovered" it the same instant: no search phase at all.
    this.data.target = target.clone()
  }

  set setTotalAnts(total: number) {
    this.data.totalAntsInNest = total
  }

  set setNest(target: Vector3) {
    this.data.nest = target
  }

  set setReproduction(value: boolean) {
    this.data.reproductionOn = value
  }

  isEndOfLife(): boolean {
    const lifeTime = Math.ceil(Math.abs(simNow() - this.data.bornAt))
    return lifeTime > this.data.lifeTime && this.data.reproductionOn
  }

  isReproductionTime(): boolean {
    const lifeTime = Math.ceil(Math.abs(simNow() - this.data.bornAt))
    return lifeTime >= this.data.reproductionTime && this.data.reproductionOn && !this.data.cloned
  }

  hadDiscoveredAllTargets(): boolean {
    return (
      (Object.keys(this.data.behaviour.discoveredPositions) as TaskName[]).filter(
        (task) => this.data.behaviour.discoveredPositions[task] === false,
      ).length === 0
    )
  }

  isTargetGetDiscovered(): boolean {
    const taskType = this.data.behaviour.actualTask.type
    const pos = this.data.body.position
    if (!pos) return false
    // Food is found through discoverFood(): there are several spots, not one site.
    if (taskType === 'Collect') return false
    return (
      !this.data.behaviour.discoveredPositions[taskType] &&
      this.between(TASK_POSITIONS[taskType].x - pos.x, NEG_DISCOVERED_TARGET_MATCH, POS_DISCOVERED_TARGET_MATCH) &&
      this.between(TASK_POSITIONS[taskType].z - pos.z, NEG_DISCOVERED_TARGET_MATCH, POS_DISCOVERED_TARGET_MATCH)
    )
  }

  isArrivedTo(pos: 'target' | 'nest'): boolean {
    const ref = this.data[pos]
    console.log({ref, pos: this.data.body.position})
    if (!ref) return false
    return (
      this.between(this.data.body.position.x - ref.x, NEG_TARGET_MATCH, POS_TARGET_MATCH) &&
      this.between(this.data.body.position.z - ref.z, NEG_TARGET_MATCH, POS_TARGET_MATCH)
    )
  }

  isArrivedToTarget(): boolean {
    let isTargetGetDiscovered = this.isTargetGetDiscovered()
    console.log({isTargetGetDiscovered})
    if (isTargetGetDiscovered) {
      this.data.behaviour.discoveredPositions[this.data.behaviour.actualTask.type] = true
    }
    this.discoverFood()
    const arrived = this.isArrivedTo('target')
    if (arrived) this.arriveAtFoodSpot()
    return arrived
  }

  // --- food spots ------------------------------------------------------------

  /** Where to walk for `task`: a remembered food spot, a known site, or a random search point. */
  private targetFor(task: TaskName): Vector3 {
    if (task === 'Collect') {
      if (!this.foodMemory && !AUTODISCOVERING && FOOD_SPOTS.length > 0) {
        this.rememberFood(FOOD_SPOTS[Math.floor(Math.random() * FOOD_SPOTS.length)])
      }
      return this.foodMemory ? this.foodMemory.at : getRandomTarget()
    }
    return !AUTODISCOVERING || this.data.behaviour.discoveredPositions[task] ? TASK_POSITIONS[task] : getRandomTarget()
  }

  /** Seen with its own eyes: food is there right now. */
  rememberFood(spot: FoodSpot): void {
    this.foodMemory = { spot, epoch: spot.epoch, at: spot.position.clone(), confirmedAt: simNow() }
    this.data.behaviour.discoveredPositions.Collect = true
  }

  /** Learn a nestmate's memory as-is, stale or not: it is what they believe. */
  learnFood(memory: NonNullable<Ant['foodMemory']>): void {
    if (this.knowsIsEmpty(memory)) return
    this.foodMemory = { spot: memory.spot, epoch: memory.epoch, at: memory.at.clone(), confirmedAt: memory.confirmedAt }
    this.data.behaviour.discoveredPositions.Collect = true
  }

  knowsIsEmpty(memory: NonNullable<Ant['foodMemory']>): boolean {
    return this.knownEmpty.get(memory.spot) === memory.epoch
  }

  /** Saw it (or was told it is) empty: forget it and remember that it is dead. */
  markEmpty(memory: NonNullable<Ant['foodMemory']>): void {
    this.knownEmpty.set(memory.spot, memory.epoch)
    if (this.foodMemory && this.foodMemory.spot === memory.spot && this.foodMemory.epoch === memory.epoch) {
      this.forgetFood()
    }
  }

  /** Worth passing on: food was seen there recently (first-hand or by a recent chain). */
  hasFreshFoodNews(): boolean {
    return !!this.foodMemory && simNow() - this.foodMemory.confirmedAt <= FOOD_NEWS_FRESH_MS
  }

  forgetFood(): void {
    this.foodMemory = null
    this.data.behaviour.discoveredPositions.Collect = false
  }

  /** A collector with no spot in mind notices any spot with food it comes close to. */
  private discoverFood(): void {
    if (this.data.behaviour.actualTask.type !== 'Collect' || this.foodMemory) return
    const spot = foodSpotNear(this.data.body.position)
    if (spot) this.rememberFood(spot)
  }

  /** Reached the remembered spot: pick food up, or find it gone and forget it. */
  private arriveAtFoodSpot(): void {
    const memory = this.foodMemory
    if (this.data.behaviour.actualTask.type !== 'Collect' || !memory || !this.data.target) return
    if (Vector3.Distance(this.data.target, memory.at) > 1) return // this leg was not to the spot
    const stillThere = memory.spot.epoch === memory.epoch && memory.spot.remaining > 0
    if (!stillThere) {
      this.markEmpty(memory)
      this.discoverFood() // the respawned spot may happen to be close by
      return
    }
    this.carried += this.forage?.(memory.spot) ?? 0
    memory.confirmedAt = simNow()
    // This trip took the last of it: the ant saw it go, so it stops recruiting to it.
    if (memory.spot.epoch !== memory.epoch) this.markEmpty(memory)
  }

  /** Hand over what was carried home; called by the Colony on the nest visit. */
  dropCarried(): number {
    const amount = this.carried
    this.carried = 0
    return amount
  }

  isArrivedToNest(): boolean {
    return this.isArrivedTo('nest')
  }

  iAmOverreacting(need: TaskName): boolean {
    const n = this.data.nestNeeds![need]
    return n.actual + n.dedicated_ants >= n.need
  }

  nestIsOverreacting(need: TaskName): boolean {
    const n = this.data.nestNeeds![need]
    return n.dedicated_ants < (this.data.totalAntsInNest / 4) * 3
  }

  getSimulatedValue(task: TaskName): number {
    const ranks = this.data.behaviour.rankTasks as Record<TaskName, number>
    return (ranks[task] += this.data.behaviour.geneticalPriority[task]) * this.data.nestNeeds![task].urgency
  }

  simulateRankResult(simulatedImplement: number): boolean {
    return simulatedImplement <= 99
  }

  minimumAntsPerTask(previousTask: TaskName): boolean {
    const n = this.data.nestNeeds![previousTask]
    return n.dedicated_ants > n.min_dedicated_ants
  }

  shouldSwitchTask(previousTask: TaskName, actualTask: TaskName): boolean {
    const needs = this.data.nestNeeds!
    const isUrgent = needs[previousTask].urgency < needs[actualTask].urgency
    const isOverreacting = (this.iAmOverreacting(previousTask) || this.nestIsOverreacting(previousTask)) && !this.nestIsOverreacting(actualTask)
    const isMinimumAntsPerTask = this.minimumAntsPerTask(previousTask)
    return (isUrgent || isOverreacting) && isMinimumAntsPerTask
  }

  rankingNeeds(): void {
    const ranks = this.data.behaviour.rankTasks as Record<TaskName, number>
      ; (Object.keys(this.data.nestNeeds!) as TaskName[]).forEach((need) => {
        if (ranks[need] !== 0) {
          const simulatedNeedImplement = this.getSimulatedValue(need)
          if (this.iAmOverreacting(need)) ranks[need] = 0
          if (this.simulateRankResult(simulatedNeedImplement)) {
            ranks[need] += simulatedNeedImplement - ranks[need]
          } else {
            ranks[need] = 90
          }
        }
      })
  }

  getSortedRankTasks(sortedRankedTasks: [TaskName, number][]): [TaskName, number][] {
    const ranks = this.data.behaviour.rankTasks as Record<TaskName, number>
      ; (Object.keys(ranks) as TaskName[]).forEach((task) => {
        sortedRankedTasks.push([task, ranks[task]])
      })
    sortedRankedTasks.sort((a, b) => b[1] - a[1])
    return sortedRankedTasks
  }

  assignNewTask(previousTask: TaskName, actualTask: [TaskName, number]): AntData {
    // Original line preserved: when actualTask[0] === previousTask (dead branch in practice
    // because sortedRankedTasks contains each task exactly once), the original code
    // assigns actualTask[1] (a numeric score) to currentTask. Cast keeps the quirk visible.
    let currentTask = (actualTask[0] !== previousTask ? actualTask[0] : actualTask[1]) as TaskName
    const shouldSwitch = !!previousTask && this.shouldSwitchTask(previousTask, currentTask)
    if (!shouldSwitch) currentTask = previousTask
    this.setTarget = this.targetFor(currentTask)
    if (this.hadDiscoveredAllTargets()) {
      ; (this.data.body.material as StandardMaterial).emissiveColor = Color3.White()
    }
    this.data.behaviour.actualTask.type = shouldSwitch ? currentTask : previousTask
    this.data.behaviour.actualTask.interactionPercentage = shouldSwitch
      ? actualTask[1]
      : this.data.behaviour.actualTask.interactionPercentage
    this.data.behaviour.actualTask.lastInteraction = simNow()
    return this.data
  }

  // --- threshold switching ---------------------------------------------------

  private decayTally(): void {
    const now = simNow()
    const factor = Math.pow(0.5, (now - this.tallyUpdatedAt) / ENCOUNTER_HALF_LIFE_MS)
    this.tallyUpdatedAt = now
    if (factor >= 1) return
    ;(Object.keys(this.encounterTally) as TaskName[]).forEach((t) => (this.encounterTally[t] *= factor))
  }

  /** Count a meeting once per partner per cooldown; contact lasts several frames. */
  private recordEncounter(other: Ant): void {
    if (other === this) return
    const now = simNow()
    const last = this.lastMet.get(other.data.id)
    if (last !== undefined && now - last < ENCOUNTER_COOLDOWN_MS) return
    this.lastMet.set(other.data.id, now)
    if (this.lastMet.size > 256) this.lastMet.clear()
    this.decayTally()
    this.encounterTally[other.data.behaviour.actualTask.type] += 1
    this.onEncounter?.(other)
  }

  /** Share of recent meetings with ants on `task`, as this ant perceives it. */
  encounterShare(task: TaskName): number {
    this.decayTally()
    const tasks = Object.keys(this.encounterTally) as TaskName[]
    const total = tasks.reduce((sum, t) => sum + this.encounterTally[t], 0) + ENCOUNTER_PRIOR * tasks.length
    return (this.encounterTally[task] + ENCOUNTER_PRIOR) / total
  }

  /** Urgency discounted by how crowded the task looks from here: > 1 means under-staffed. */
  perceivedPressure(task: TaskName): number {
    const urgency = this.data.nestNeeds![task].urgency
    const fairShare = 1 / Object.keys(this.encounterTally).length
    return (Number.isFinite(urgency) ? Math.max(0, urgency) : 1e6) * (fairShare / this.encounterShare(task))
  }

  private assignByThreshold(previousTask: TaskName): void {
    const tasks = Object.keys(this.data.nestNeeds!) as TaskName[]
    const current = this.perceivedPressure(previousTask)
    let candidate = previousTask
    let best = current
    tasks.forEach((t) => {
      const p = this.perceivedPressure(t)
      if (p > best) {
        best = p
        candidate = t
      }
    })

    let switched = false
    let probability = 0
    // Never leave a task below its minimum crew (same rule as the legacy model).
    if (candidate !== previousTask && this.minimumAntsPerTask(previousTask)) {
      const stimulus = current > 0 ? best / current - 1 : 1e6
      const theta = this.thresholds[candidate]
      probability = (stimulus * stimulus) / (stimulus * stimulus + theta * theta)
      switched = Math.random() < probability
    }
    const task = switched ? candidate : previousTask

    this.setTarget = this.targetFor(task)
    if (this.hadDiscoveredAllTargets()) {
      ;(this.data.body.material as StandardMaterial).emissiveColor = Color3.White()
    }
    this.data.behaviour.actualTask.type = task
    if (switched) this.data.behaviour.actualTask.interactionPercentage = Math.round(probability * 100)
    this.data.behaviour.actualTask.lastInteraction = simNow()
  }

  goToSleep(): void {
    // isSleeping first: stop() fires the animation-end callback, which bails out when sleeping.
    // (pause() used to leave one dead animatable per sleep cycle in scene.animatables.)
    this.isSleeping = true
    this.data.animation?.stop()
    // A random spot inside the sleep chamber under the nest.
    const r = SLEEP_CHAMBER_RADIUS * Math.cbrt(Math.random())
    const theta = Math.random() * Math.PI * 2
    const phi = Math.acos(2 * Math.random() - 1)
    this.data.body.position = SLEEP_POSITION.add(
      new Vector3(r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta)),
    )
    this.awakeTime = simSetTimeout(() => this.awake(), getNapDuration())
  }

  awake(): void {
    this.data.body.position = new Vector3(0, 0, 0)
    this.isSleeping = false
    this.moveTo()
    if (this.awakeTime) simClearTimer(this.awakeTime)
  }

  live(): void {
    console.log('live')
    if (this.data.nest) this.data.body.position = this.data.nest
    this.moveTo()
    this.checkTaskInterval = simSetInterval(() => (!this.isSleeping ? this.check() : null), getPerformTaskInterval())
    this.sleep = simSetInterval(() => (!this.isSleeping ? this.goToSleep() : null), getSleepingInterval())
    this.decreaseTaskInterval = simSetInterval(() => this.decreaseTasks(), getDecreaseInterval())
    console.log({
      checkTaskInterval: this.checkTaskInterval,
      sleep: this.sleep,
      decreaseTaskInterval: this.decreaseTaskInterval
    })
  }

  check(): void {
    console.log("check")
    if (this.isEndOfLife()) {
      console.log('is end of life')
      this.dispose()
      return
    }
    if (this.isReproductionTime()) {
      // Preserved original line — was `this.data.cloned === true` (comparison, not assignment).
      // Intentionally left as-is to keep model behavior identical to the 2021 implementation.
      console.log('isReproductionTime')
      this.data.cloned === true
      this.data.reproductionCallback?.()
    }
  }

  findNewScope(): void {
    if (!this.isArrivedToNest()) {
      if (this.data.nest) this.setTarget = this.data.nest
      return
    }
    const previousTask = this.data.behaviour.actualTask.type
    const calculatedIncreaseValue = this.data.behaviour.discoveredPositions[previousTask]
      ? INCREASE_MAIN_TASK * this.data.behaviour.geneticalPriority[previousTask]
      : 0
    if (SWITCH_MODEL === 'threshold' && this.data.nestNeeds) {
      this.assignByThreshold(previousTask)
    } else {
      if (this.data.nestNeeds) this.rankingNeeds()
      const sortedRankedTasks = this.getSortedRankTasks([])
      const nextTask = previousTask === sortedRankedTasks[0][0] ? sortedRankedTasks[1] : sortedRankedTasks[0]
      this.assignNewTask(previousTask, nextTask)
    }
    this.data.nestCallback?.(this.data.id, this.data.behaviour.actualTask, previousTask, calculatedIncreaseValue)
  }

  moveTo(): void {
    console.log({target: this.data.target, position: this.data.body.position})
    if (!this.data.target) return
    this.data.animation = Animation.CreateAndStartAnimation(
      `${this.data.id}-animation`,
      this.data.body,
      'position',
      60,
      Math.floor((Math.random() * (CHECK_TIME_INTERVAL - MIN_CHECK_TIME_INTERVAL) + MIN_CHECK_TIME_INTERVAL) / 60),
      this.data.body.position,
      this.data.target,
      Animation.ANIMATIONLOOPMODE_CONSTANT,
      undefined,
      () => {
        let isSleeping = this.isSleeping
        let isArrivedToTarget = this.isArrivedToTarget()
        console.log('callback', {
          isSleeping,
          isArrivedToTarget
        })
        if (isSleeping) return
        if (isArrivedToTarget) {
          this.findNewScope()
        }
        this.moveTo()
      },
    )
  }

  registerCollider(list: Ant[]): void {
    this.collider = (this.data.babylonElements.scene as Scene).onBeforeRenderObservable.add(() => {
      // Sleeping ants don't meet anyone, and nobody meets them.
      if (this.isSleeping) return
      if (DISCOVER_ALONG_PATH && this.isTargetGetDiscovered()) {
        this.data.behaviour.discoveredPositions[this.data.behaviour.actualTask.type] = true
      }
      if (DISCOVER_ALONG_PATH) this.discoverFood()
      list.forEach((element) => {
        if (!element.data || element.isSleeping) return
        if ((this.data.body as AbstractMesh).intersectsMesh(element.data.body as AbstractMesh, true)) {
          this.setInfluence(element)
          this.reportedCollision = true
        }
      })
    })
  }

  decreaseTasks(): void {
    const ranks = this.data.behaviour.rankTasks as Record<TaskName, number>
      ; (Object.keys(ranks) as TaskName[]).forEach((task) => {
        if (ranks[task] > 10) ranks[task] -= 1
      })
  }

  setInfluence(encounteredAnt: Ant): void {
    if (SWITCH_MODEL === 'threshold') this.recordEncounter(encounteredAnt)
    const encounteredAntBehaviour = encounteredAnt.data.behaviour
    if (TASKS[this.data.type].indexOf(encounteredAntBehaviour.actualTask.type) === -1) return

    const myDiscovered = this.data.behaviour.discoveredPositions
    const otherDiscovered = encounteredAntBehaviour.discoveredPositions
    const myTask = this.data.behaviour.actualTask.type
    const otherTask = encounteredAntBehaviour.actualTask.type

    let shared = false
    // Dead-spot news first: whoever has seen a spot empty corrects whoever still believes in it.
    if (encounteredAnt.foodMemory && this.knowsIsEmpty(encounteredAnt.foodMemory)) {
      encounteredAnt.markEmpty(encounteredAnt.foodMemory)
    }
    if (this.foodMemory && encounteredAnt.knowsIsEmpty(this.foodMemory)) {
      this.markEmpty(this.foodMemory)
    }
    // Food knowledge is a specific spot, so it is passed on as a memory, not a flag.
    if (myTask === 'Collect') {
      if (!this.foodMemory && encounteredAnt.foodMemory && encounteredAnt.hasFreshFoodNews()) {
        this.learnFood(encounteredAnt.foodMemory)
        shared = true
      }
    } else if (otherDiscovered[myTask] && !myDiscovered[myTask]) {
      myDiscovered[myTask] = otherDiscovered[myTask]
      shared = true
    }
    if (otherTask === 'Collect') {
      if (!encounteredAnt.foodMemory && this.foodMemory && this.hasFreshFoodNews()) {
        encounteredAnt.learnFood(this.foodMemory)
        shared = true
      }
    } else if (myDiscovered[otherTask] && !otherDiscovered[otherTask]) {
      otherDiscovered[otherTask] = myDiscovered[otherTask]
      shared = true
    }
    if (shared) this.onKnowledgeShared?.(this.data.body.position)

    const ranks = this.data.behaviour.rankTasks as RankTasks
    const bump = encounteredAntBehaviour.actualTask.interactionPercentage * ANT_INFLUENCE_FACTOR
    if (!ranks[otherTask]) {
      ranks[otherTask] = bump
    }
    if ((ranks[otherTask] ?? 0) > 99) {
      ranks[otherTask] = (ranks[otherTask] ?? 0) + bump
    }
  }

  dispose(): void {
    console.log('------ die')
    if (this.checkTaskInterval) simClearTimer(this.checkTaskInterval)
    if (this.sleep) simClearTimer(this.sleep)
    if (this.decreaseTaskInterval) simClearTimer(this.decreaseTaskInterval)
    simClearTimer(this.awakeTime)
    this.data.target = undefined // makes the end callback triggered by stop() a no-op
    this.data.animation?.stop()
    ;(this.data.babylonElements.scene as Scene).onBeforeRenderObservable.remove(this.collider)
    this.data.body.dispose()
    this.data.disposeCallback?.()
  }
}
