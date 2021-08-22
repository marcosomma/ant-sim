import { v1 } from 'uuid'
import * as BABYLON from 'babylonjs'
import { createSphere } from '../commons/meshCreator'

const RANDOM_RADIUS = 35
const AUTODISCOVERING = true
const ANT_INFLUENCE_FACTOR = Math.random() / 1e6
const TASKS = {
  P: ['Protection', 'Store', 'Cleaning', 'Expansion', 'Exploration'],
  W: ['Collect', 'Store', 'Cleaning', 'Expansion', 'Exploration'],
}
export const CHECK_TIME_INTERVAL = 30e3 + (Math.random() * 10e3)
export const TASK_POSITIONS = {
  Store: new BABYLON.Vector3(-150, 0, 0),
  Exploration: new BABYLON.Vector3(-100, 100, 0),
  Collect: new BABYLON.Vector3(150, 0, 0),
  Protection: new BABYLON.Vector3(100, -100, 0),
  Expansion: new BABYLON.Vector3(-100, -100, 0),
  Cleaning: new BABYLON.Vector3(100, 100, 0),
}
export const TASK_PRIORITY = {
  Protection: Math.random(),
  Exploration: Math.random(),
  Collect: Math.random(),
  Store: Math.random(),
  Expansion: Math.random(),
  Cleaning: Math.random(),
}

const getRandomArbitrary = (min, max) => Math.random() * (max - min) + min
const randomPointInRadius = (positive) => Math.random() * (positive ? RANDOM_RADIUS : -RANDOM_RADIUS) * (Math.PI * 2)
const getGeneticOrientedTask = (type) => TASKS[type][Math.floor(Math.random() * TASKS[type].length)]
const getReproductionTime = () => Math.floor(Math.random() * CHECK_TIME_INTERVAL * 30)
const getRandomTarget = () =>
  new BABYLON.Vector3(
    getRandomArbitrary(randomPointInRadius(false), randomPointInRadius(true)), 
    getRandomArbitrary(randomPointInRadius(false), randomPointInRadius(true)), 
    0)

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
  beheviour: {
    actualTask: {
      type: getGeneticOrientedTask(type),
      interactionPercentage: Math.floor(Math.random() * 1),
      lastInteraction: Date.now(),
    },
    rankTasks: {},
    discoveredPositions: {
      Protection: !AUTODISCOVERING,
      Exploration: !AUTODISCOVERING,
      Collect: !AUTODISCOVERING,
      Store: !AUTODISCOVERING,
      Expansion: !AUTODISCOVERING,
      Cleaning: !AUTODISCOVERING,
    },
    geneticalPriority: {
      Protection: Math.random()+ 1,//Math.floor(Math.random() * type === 'W' ? 9 : 10),
      Exploration: Math.random()+ 1,//Math.floor(Math.random() * type === 'W' ? 9 : 10),
      Collect: Math.random()+ 1,//Math.floor(Math.random() * type === 'W' ? 10 : 9),
      Store: Math.random()+ 1,//Math.floor(Math.random() * type === 'W' ? 10 : 9),
      Expansion: Math.random()+ 1,//Math.floor(Math.random() * type === 'W' ? 9 : 10),
      Cleaning: Math.random()+ 1,//Math.floor(Math.random() * type === 'W' ? 10 : 9),
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
      type === 'W' ? 1.5 : 3,
      12,
      new BABYLON.Color3(Math.random() * 1, Math.random() * 1, Math.random() * 1),
      camera,
      scene
    )
    ant.body.position = new BABYLON.Vector3(0, 0, 0)

    this.data = ant
    this.reportedCollision = false
    this.setTarget = AUTODISCOVERING ? getRandomTarget() : TASK_POSITIONS[ant.beheviour.actualTask.type]
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
      if (!this.data.beheviour.rankTasks[task]) this.data.beheviour.rankTasks[task] = this.data.beheviour.geneticalPriority[task] * needs[task].urgency
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

  isArrivedToTarget() {
    if (
      !this.data.beheviour.discoveredPositions[this.data.beheviour.actualTask.type] &&
      this.between(TASK_POSITIONS[this.data.beheviour.actualTask.type].x - this.data.target.x, -2.5, 2.5) &&
      this.between(TASK_POSITIONS[this.data.beheviour.actualTask.type].z - this.data.target.z, -2.5, 2.5)
    ) {
      this.data.beheviour.discoveredPositions[this.data.beheviour.actualTask.type] = true
    }
    return this.between(this.data.body.position.x - this.data.target.x, -0.5, 0.5) && this.between(this.data.body.position.z - this.data.target.z, -0.5, 0.5)
  }

  isArrivedToNest() {
    return this.between(this.data.body.position.x - this.data.nest.x, -0.5, 0.5) && this.between(this.data.body.position.z - this.data.nest.z, -0.5, 0.5)
  }

  iAmOverreacting(need) {
    return this.data.nestNeeds[need].actual + this.data.nestNeeds[need].dedicated_ants >= this.data.nestNeeds[need].need
  }

  nestIsOverreacting(need) {
    return this.data.nestNeeds[need].dedicated_ants < (this.data.totalAntsInNest / 4) * 3
  }

  getSimulatedValue(task) {
    return (this.data.beheviour.rankTasks[task] += this.data.beheviour.geneticalPriority[task]) * this.data.nestNeeds[task].urgency
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
      if (this.data.beheviour.rankTasks[need] !== 0) {
        let simulatedNeedImplement = this.getSimulatedValue(need)
        if (this.iAmOverreacting(need)) this.data.beheviour.rankTasks[need] = 0
        if (this.simulateRankResult(simulatedNeedImplement)) {
          this.data.beheviour.rankTasks[need] += simulatedNeedImplement - this.data.beheviour.rankTasks[need]
        } else {
          this.data.beheviour.rankTasks[need] = 90
        }
      }
    })
  }

  getSortedRankTasks(sortedRankedTasks) {
    Object.keys(this.data.beheviour.rankTasks).forEach((task) => {
      sortedRankedTasks.push([task, this.data.beheviour.rankTasks[task]])
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
    this.setTarget = !AUTODISCOVERING || this.data.beheviour.discoveredPositions[currentTask] ? TASK_POSITIONS[currentTask] : getRandomTarget()
    this.data.beheviour.actualTask.type = shouldSwitchTask ? currentTask : preaviousTask
    this.data.beheviour.actualTask.interactionPercentage = shouldSwitchTask ? actualTask[1] : this.data.beheviour.actualTask.interactionPercentage
    this.data.beheviour.actualTask.lastInteraction = Date.now()
    return this.data
  }

  goToSleep() {
    this.data.body.position = new BABYLON.Vector3(0, -(Math.random() * 30 + 6), 0)
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
    this.performTaskInterval = setInterval(() => (!this.isSleeping ? this.performTask() : null), Math.floor(Math.random() * CHECK_TIME_INTERVAL))
    this.sleep = setInterval(
      () => (!this.isSleeping && this.isArrivedToNest() ? this.goToSleep() : null),
      Math.floor(CHECK_TIME_INTERVAL + (Math.random() * CHECK_TIME_INTERVAL)) + (CHECK_TIME_INTERVAL * (Math.floor(Math.random() * 24)))
    )
    this.decreseTaskInterval = setInterval(() => this.decreseTasks(), CHECK_TIME_INTERVAL / 1e3 > 0.1 ? CHECK_TIME_INTERVAL / 1e3 : 0.1)
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
      if (this.data.nestNeeds) {
        this.rankingNeeds()
      }
      let preaviousTask = (' ' + this.data.beheviour.actualTask.type).slice(1)
      let sortedRankedTasks = this.getSortedRankTasks([])
      let nextTask = preaviousTask === sortedRankedTasks[0][0] ? sortedRankedTasks[1] : sortedRankedTasks[0]

      this.assignNewTask(preaviousTask, nextTask)
      this.data.nestCallback(this.data.id, this.data.beheviour.actualTask, preaviousTask, 0.75 * this.data.beheviour.geneticalPriority[preaviousTask])
    }
  }

  moveTo() {
    BABYLON.Animation.CreateAndStartAnimation(
      `${this.data.id}-animation`,
      this.data.body,
      'position',
      60,
      Math.random() * (CHECK_TIME_INTERVAL / 60),
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
    Object.keys(this.data.beheviour.rankTasks).map((task) => {
      if (this.data.beheviour.rankTasks[task] > 10) this.data.beheviour.rankTasks[task] -= 1
    })
  }

  setInfluence(encountredAnt) {
    if (encountredAnt.data.beheviour.discoveredPositions[this.data.beheviour.actualTask.type] && !this.data.beheviour.discoveredPositions[this.data.beheviour.actualTask.type]) {
      this.data.beheviour.discoveredPositions[this.data.beheviour.actualTask.type] = encountredAnt.data.beheviour.discoveredPositions[this.data.beheviour.actualTask.type]
    }
    if (
      this.data.beheviour.discoveredPositions[encountredAnt.data.beheviour.actualTask.type] &&
      !encountredAnt.data.beheviour.discoveredPositions[encountredAnt.data.beheviour.actualTask.type]
    ) {
      encountredAnt.data.beheviour.discoveredPositions[encountredAnt.data.beheviour.actualTask.type] = this.data.beheviour.discoveredPositions[
        encountredAnt.data.beheviour.actualTask.type
      ]
    }

    if (TASKS[this.data.type].indexOf(encountredAnt.data.beheviour.actualTask.type) === -1) return
    if (!this.data.beheviour.rankTasks[encountredAnt.data.beheviour.actualTask.type])
      this.data.beheviour.rankTasks[encountredAnt.data.beheviour.actualTask.type] = encountredAnt.data.beheviour.actualTask.interactionPercentage * ANT_INFLUENCE_FACTOR
    if (this.data.beheviour.rankTasks[encountredAnt.data.beheviour.actualTask.type] > 99)
      this.data.beheviour.rankTasks[encountredAnt.data.beheviour.actualTask.type] += encountredAnt.data.beheviour.actualTask.interactionPercentage * ANT_INFLUENCE_FACTOR
  }

  dispose() {
    clearInterval(this.performTaskInterval)
    clearInterval(this.sleep)
    clearInterval(this.decreseTaskInterval)
    this.data.disposeCallback()
    return
  }
}
