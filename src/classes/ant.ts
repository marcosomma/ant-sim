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
    this.setTarget = AUTODISCOVERING ? getRandomTarget() : TASK_POSITIONS[ant.behaviour.actualTask.type]
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
    this.data.target = target
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
    return this.isArrivedTo('target')
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
    this.setTarget = !AUTODISCOVERING || this.data.behaviour.discoveredPositions[currentTask]
      ? TASK_POSITIONS[currentTask]
      : getRandomTarget()
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

    this.setTarget =
      !AUTODISCOVERING || this.data.behaviour.discoveredPositions[task] ? TASK_POSITIONS[task] : getRandomTarget()
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
    if (otherDiscovered[myTask] && !myDiscovered[myTask]) {
      myDiscovered[myTask] = otherDiscovered[myTask]
      shared = true
    }
    if (myDiscovered[otherTask] && !otherDiscovered[otherTask]) {
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
