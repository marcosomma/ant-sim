import { v1 } from 'uuid'
import * as BABYLON from 'babylonjs'
import { createSphere } from '../commons/meshCreator'

const INCERESE_MAIN_TASK = 0.55
const NEG_TARGET_MATCH = -0.5
const POS_TARGET_MATCH = 0.5
const NEG_DICSOVERED_TARGET_MATCH = -10
const POS_DICSOVERED_TARGET_MATCH = 10
const SEARCHING_RADIUS = 50
const AUTODISCOVERING = true
const ANT_INFLUENCE_FACTOR = Math.random() / 1e6
const MIN_CHECK_TIME_INTERVAL = 5e3
const CHECK_TIME_INTERVAL = Math.random() * (15e3 - MIN_CHECK_TIME_INTERVAL) + MIN_CHECK_TIME_INTERVAL
const TASKS = {
  P: ['Protection', 'Store', 'Cleaning', 'Expansion', 'Exploration', 'QueenCare', 'EggLarvePupeaCare'],
  W: ['Collect', 'Store', 'Cleaning', 'Expansion', 'Exploration', 'QueenCare', 'EggLarvePupeaCare'],
}
const getRandomPos = () => Math.random() * (SEARCHING_RADIUS * (Math.PI * 1.35) - 40) + 40
export const SLEEP_POSITION = new BABYLON.Vector3(-SEARCHING_RADIUS * (Math.PI * 2), SEARCHING_RADIUS * (Math.PI * 1.5), 0)
export const TASK_POSITIONS = {
  Store: new BABYLON.Vector3(-getRandomPos(), 0, 0),
  Exploration: new BABYLON.Vector3(-getRandomPos(), getRandomPos(), 0),
  Collect: new BABYLON.Vector3(getRandomPos(), 0, 0),
  Protection: new BABYLON.Vector3(getRandomPos(), -getRandomPos(), 0),
  Expansion: new BABYLON.Vector3(-getRandomPos(), -getRandomPos(), 0),
  Cleaning: new BABYLON.Vector3(getRandomPos(), getRandomPos(), 0),
  QueenCare: new BABYLON.Vector3(0, getRandomPos(), 0),
  EggLarvePupeaCare: new BABYLON.Vector3(0, -getRandomPos(), 0),
}
export const TASK_PRIORITY = {
  Protection: Math.random(),
  Exploration: Math.random(),
  QueenCare: Math.random(),
  EggLarvePupeaCare: Math.random(),
  Collect: Math.random(),
  Store: Math.random(),
  Expansion: Math.random(),
  Cleaning: Math.random(),
}

const getRandomArbitrary = (min, max) => Math.random() * (max - min) + min
const randomPointInRadius = (positive) => Math.random() * (positive ? SEARCHING_RADIUS : -SEARCHING_RADIUS) * (Math.PI * 2)
const getGeneticOrientedTask = (type) => TASKS[type][Math.floor(Math.random() * TASKS[type].length)]
const getReproductionTime = () => Math.floor(Math.random() * CHECK_TIME_INTERVAL * 30)
const getRandomTarget = () =>
  new BABYLON.Vector3(getRandomArbitrary(randomPointInRadius(false), randomPointInRadius(true)), getRandomArbitrary(randomPointInRadius(false), randomPointInRadius(true)), 0)

const getSize = (type) => {
  switch (type) {
    case 'P':
      return 'big'
    default:
      return 'small'
  }
}

const antObj = (type) => ({
  id: v1(),
  type,
  size: getSize(type),
  bornAt: Date.now(),
  cloned: false,
  reproducrionOn: true,
  sleeping: false,
  reproductionTime: null,
  lifeTime: null,
  totalAntsInNest: 0,
  behaviour: {
    actualTask: {
      type: getGeneticOrientedTask(type),
      interactionPercentage: Math.floor(Math.random() * 1),
      lastInteraction: Date.now(),
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
      Protection: Math.random() + 1, //Math.floor(Math.random() * type === 'W' ? 9 : 10),
      Exploration: Math.random() + 1, //Math.floor(Math.random() * type === 'W' ? 9 : 10),
      QueenCare: Math.random() + 1, //Math.floor(Math.random() * type === 'W' ? 9 : 10),
      EggLarvePupeaCare: Math.random() + 1, //Math.floor(Math.random() * type === 'W' ? 9 : 10),
      Collect: Math.random() + 1, //Math.floor(Math.random() * type === 'W' ? 10 : 9),
      Store: Math.random() + 1, //Math.floor(Math.random() * type === 'W' ? 10 : 9),
      Expansion: Math.random() + 1, //Math.floor(Math.random() * type === 'W' ? 9 : 10),
      Cleaning: Math.random() + 1, //Math.floor(Math.random() * type === 'W' ? 10 : 9),
    },
  },
  body: null,
  babylonElements: null,
})

export default class Ant {
  constructor(type, camera, scene) {
    let ant = new Object(antObj(type))
    ant.reproductionTime = getReproductionTime()
    ant.lifeTime = Math.floor(Math.random() * ant.reproductionTime) + ant.reproductionTime
    ant.babylonElements = {
      scene,
      camera,
    }
    ant.body = createSphere(
      { id: ant.id, name: `${type} - ${ant.id}` },
      type === 'W' ? 2 : 4,
      12,
      new BABYLON.Color3(Math.random() * 1, Math.random() * 1, Math.random() * 1),
      camera,
      scene
    )
    ant.body.position = new BABYLON.Vector3(0, 0, 0)

    this.data = ant
    this.reportedCollision = false
    this.setTarget = AUTODISCOVERING ? getRandomTarget() : TASK_POSITIONS[ant.behaviour.actualTask.type]
    this.setNest = new BABYLON.Vector3(0, 0, 0)

    return this
  }

  between(x, min, max) {
    return x >= min && x <= max
  }

  set setNestCallback(cb) {
    this.data.nestCallback = (id, actualTask, preaviousTask, addedValue) => cb(id, actualTask, preaviousTask, addedValue)
  }

  set setReproductionCallback(cb) {
    this.data.reproductionCallback = () => cb(this.data.id)
  }

  set setDisposeCallback(cb) {
    this.data.disposeCallback = () => cb(this.data.id)
  }

  set setNestNeeds(needs) {
    Object.keys(needs).forEach((task) => {
      if (!this.data.behaviour.rankTasks[task]) this.data.behaviour.rankTasks[task] = this.data.behaviour.geneticalPriority[task] * needs[task].urgency
    })
    this.data.nestNeeds = needs
  }

  set setTarget(target) {
    this.data.target = target
  }

  set setTotalAnts(total) {
    this.data.totalAntsInNest = total
  }

  set setNest(target) {
    this.data.nest = target
  }

  set setReproduction(value) {
    this.data.reproducrionOn = value
  }

  isEndOfLife() {
    const lifeTime = Math.ceil(Math.abs(Date.now() - this.data.bornAt))
    return lifeTime >= this.data.lifeTime && this.data.reproducrionOn
  }

  isReproductionTime() {
    const lifeTime = Math.ceil(Math.abs(Date.now() - this.data.bornAt))
    return lifeTime >= this.data.reproductionTime && this.data.reproducrionOn && !this.data.cloned
  }

  isTargetGetDiscovered() {
    return (
      !this.data.behaviour.discoveredPositions[this.data.behaviour.actualTask.type] &&
      this.between(TASK_POSITIONS[this.data.behaviour.actualTask.type].x - this.data.target.x, NEG_DICSOVERED_TARGET_MATCH, POS_DICSOVERED_TARGET_MATCH) &&
      this.between(TASK_POSITIONS[this.data.behaviour.actualTask.type].z - this.data.target.z, NEG_DICSOVERED_TARGET_MATCH, POS_DICSOVERED_TARGET_MATCH)
    )
  }

  isArricedTo(pos) {
    return (
      this.between(this.data.body.position.x - this.data[pos].x, NEG_TARGET_MATCH, POS_TARGET_MATCH) &&
      this.between(this.data.body.position.y - this.data[pos].y, NEG_TARGET_MATCH, POS_TARGET_MATCH)
    )
  }

  isArrivedToTarget() {
    if (this.isTargetGetDiscovered()) {
      this.data.behaviour.discoveredPositions[this.data.behaviour.actualTask.type] = true
    }
    return this.isArricedTo('target')
  }

  isArrivedToNest() {
    return this.isArricedTo('nest')
  }

  iAmOverreacting(need) {
    return this.data.nestNeeds[need].actual + this.data.nestNeeds[need].dedicated_ants >= this.data.nestNeeds[need].need
  }

  nestIsOverreacting(need) {
    return this.data.nestNeeds[need].dedicated_ants < (this.data.totalAntsInNest / 4) * 3
  }

  getSimulatedValue(task) {
    return (this.data.behaviour.rankTasks[task] += this.data.behaviour.geneticalPriority[task]) * this.data.nestNeeds[task].urgency
  }

  simulateRankResult(simulatedImplement) {
    return simulatedImplement <= 99
  }

  minimumAntsPerTask(preaviousTask) {
    return this.data.nestNeeds[preaviousTask].dedicated_ants > this.data.nestNeeds[preaviousTask].min_dedicated_ants
  }

  shouldSwitchTask(preaviousTask, actualTask) {
    let isUrgent = this.data.nestNeeds[preaviousTask].urgency < this.data.nestNeeds[actualTask].urgency
    let isOverreacting = (this.iAmOverreacting(preaviousTask) || this.nestIsOverreacting(preaviousTask)) && !this.nestIsOverreacting(actualTask)
    let isMinimumAntsPerTask = this.minimumAntsPerTask(preaviousTask)
    return (isUrgent || isOverreacting) && isMinimumAntsPerTask
  }

  rankingNeeds() {
    Object.keys(this.data.nestNeeds).forEach((need) => {
      if (this.data.behaviour.rankTasks[need] !== 0) {
        let simulatedNeedImplement = this.getSimulatedValue(need)
        if (this.iAmOverreacting(need)) this.data.behaviour.rankTasks[need] = 0
        if (this.simulateRankResult(simulatedNeedImplement)) {
          this.data.behaviour.rankTasks[need] += simulatedNeedImplement - this.data.behaviour.rankTasks[need]
        } else {
          this.data.behaviour.rankTasks[need] = 90
        }
      }
    })
  }

  getSortedRankTasks(sortedRankedTasks) {
    Object.keys(this.data.behaviour.rankTasks).forEach((task) => {
      sortedRankedTasks.push([task, this.data.behaviour.rankTasks[task]])
    })

    sortedRankedTasks.sort(function (a, b) {
      return b[1] - a[1]
    })

    return sortedRankedTasks
  }

  assignNewTask(preaviousTask, actualTask) {
    let currentTask = actualTask[0] !== preaviousTask ? actualTask[0] : actualTask[1]
    let shouldSwitchTask = preaviousTask && this.shouldSwitchTask(preaviousTask, currentTask)
    if (!shouldSwitchTask) currentTask = preaviousTask
    this.setTarget = !AUTODISCOVERING || this.data.behaviour.discoveredPositions[currentTask] ? TASK_POSITIONS[currentTask] : getRandomTarget()
    this.data.behaviour.actualTask.type = shouldSwitchTask ? currentTask : preaviousTask
    this.data.behaviour.actualTask.interactionPercentage = shouldSwitchTask ? actualTask[1] : this.data.behaviour.actualTask.interactionPercentage
    this.data.behaviour.actualTask.lastInteraction = Date.now()
    return this.data
  }

  goToSleep() {
    this.data.body.position = new BABYLON.Vector3(SLEEP_POSITION.x, SLEEP_POSITION.y - (Math.random() * 1e2 + 6), 0)
    this.awakeTime = setInterval(() => this.awake(), CHECK_TIME_INTERVAL / 4)
    this.isSleeping = true
  }

  awake() {
    this.data.body.position = new BABYLON.Vector3(0, 0, 0)
    clearInterval(this.awakeTime)
    this.isSleeping = false
  }

  live() {
    this.data.body.position = this.data.nest
    this.performTask()

    const decreseIntervalTime = CHECK_TIME_INTERVAL / 1e3 > 0.1 ? CHECK_TIME_INTERVAL / 1e3 : 0.1
    const sleepIntervalTime = CHECK_TIME_INTERVAL + Math.random() * CHECK_TIME_INTERVAL + CHECK_TIME_INTERVAL * Math.floor(Math.random() * 24)
    const performTaskIntervalTime = Math.floor(Math.random() * CHECK_TIME_INTERVAL)
    this.performTaskInterval = setInterval(() => (!this.isSleeping ? this.performTask() : null), performTaskIntervalTime)
    this.sleep = setInterval(() => (!this.isSleeping && this.isArrivedToNest() ? this.goToSleep() : null), sleepIntervalTime)
    this.decreseTaskInterval = setInterval(() => this.decreseTasks(), decreseIntervalTime)
  }

  performTask() {
    if (this.isEndOfLife()) {
      return this.dispose()
    }
    if (this.isReproductionTime()) {
      this.data.cloned === true
      return this.data.reproductionCallback(this.data.id)
    }
    if (this.isArrivedToTarget()) {
      this.findNewScope()
    } else {
      this.moveTo()
    }
  }

  findNewScope() {
    if (!this.isArrivedToNest()) {
      this.setTarget = this.data.nest
      this.moveTo()
      return
    } else {
      if (this.data.nestNeeds) this.rankingNeeds()
      let preaviousTask = this.data.behaviour.actualTask.type
      let sortedRankedTasks = this.getSortedRankTasks([])
      let nextTask = preaviousTask === sortedRankedTasks[0][0] ? sortedRankedTasks[1] : sortedRankedTasks[0]
      let calculatedIncreseValue = INCERESE_MAIN_TASK * this.data.behaviour.geneticalPriority[preaviousTask]

      this.assignNewTask(preaviousTask, nextTask)
      this.data.nestCallback(this.data.id, this.data.behaviour.actualTask, preaviousTask, calculatedIncreseValue)
    }
  }

  moveTo() {
    BABYLON.Animation.CreateAndStartAnimation(
      `${this.data.id}-animation`,
      this.data.body,
      'position',
      60,
      Math.floor((Math.random() * (CHECK_TIME_INTERVAL - MIN_CHECK_TIME_INTERVAL) + MIN_CHECK_TIME_INTERVAL) / 60),
      this.data.body.position,
      this.data.target,
      BABYLON.Animation.ANIMATIONLOOPMODE_RELATIVE
    )
  }

  registerCollider(list) {
    this.data.babylonElements.scene.registerBeforeRender(() => {
      list.forEach((element) => {
        if (!element.data) return
        if (this.data.body.intersectsMesh(element.data.body, true)) {
          this.setInfluence(element)
          this.reportedCollision = true
        }
      })
    })
  }

  decreseTasks() {
    Object.keys(this.data.behaviour.rankTasks).map((task) => {
      if (this.data.behaviour.rankTasks[task] > 10) this.data.behaviour.rankTasks[task] -= 1
    })
  }

  setInfluence(encountredAnt) {
    const encountredAntBehaviour = encountredAnt.data.behaviour
    if (TASKS[this.data.type].indexOf(encountredAntBehaviour.actualTask.type) === -1) return

    if (encountredAntBehaviour.discoveredPositions[this.data.behaviour.actualTask.type] && !this.data.behaviour.discoveredPositions[this.data.behaviour.actualTask.type]) {
      this.data.behaviour.discoveredPositions[this.data.behaviour.actualTask.type] = encountredAntBehaviour.discoveredPositions[this.data.behaviour.actualTask.type]
    }
    if (this.data.behaviour.discoveredPositions[encountredAntBehaviour.actualTask.type] && !encountredAntBehaviour.discoveredPositions[encountredAntBehaviour.actualTask.type]) {
      encountredAntBehaviour.discoveredPositions[encountredAntBehaviour.actualTask.type] = this.data.behaviour.discoveredPositions[encountredAntBehaviour.actualTask.type]
    }
    if (!this.data.behaviour.rankTasks[encountredAntBehaviour.actualTask.type])
      this.data.behaviour.rankTasks[encountredAntBehaviour.actualTask.type] = encountredAntBehaviour.actualTask.interactionPercentage * ANT_INFLUENCE_FACTOR
    if (this.data.behaviour.rankTasks[encountredAntBehaviour.actualTask.type] > 99)
      this.data.behaviour.rankTasks[encountredAntBehaviour.actualTask.type] += encountredAntBehaviour.actualTask.interactionPercentage * ANT_INFLUENCE_FACTOR
  }

  dispose() {
    clearInterval(this.performTaskInterval)
    clearInterval(this.sleep)
    clearInterval(this.decreseTaskInterval)
    this.data.disposeCallback()
    return
  }
}
