import { v1 } from 'uuid'
import * as BABYLON from 'babylonjs'
import { createSphere } from '../commons/meshCreator'

// AntTypes : [ {workers: W}, {protector: P} ]
const ANT_INFLUENCE_FACTOR = 0.00005
const TASKS = {
  P: ['Protection', 'Store', 'Cleaning', 'Expansion', 'Exploration', 'Collect'],
  W: ['Collect', 'Store', 'Cleaning', 'Expansion', 'Exploration', 'Protection'],
}
export const CHECK_TIME_INTERVAL = 4e3
export const TASK_POSITIONS = {
  Store: new BABYLON.Vector3(-100, 0, 100),
  Exploration: new BABYLON.Vector3(-75, 75, 75),
  Collect: new BABYLON.Vector3(100, 0, -100),
  Protection: new BABYLON.Vector3(75, -75, -75),
  Expansion: new BABYLON.Vector3(-75, -75, 75),
  Cleaning: new BABYLON.Vector3(75, 75, -75),
}
export const TASK_PRIORITY = {
  Protection: Math.random(),
  Exploration: Math.random(),
  Collect: Math.random(),
  Store: Math.random(),
  Expansion: Math.random(),
  Cleaning: Math.random(),
}

const getGeneticOrientedTask = (type) => TASKS[type][Math.floor(Math.random() * TASKS[type].length)]
const getReproductionTime = () => Math.floor(Math.random() * CHECK_TIME_INTERVAL * 30) + CHECK_TIME_INTERVAL * 30

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
  reproductionTime: null,
  lifeTime: null,
  beheviour: {
    actualTask: {
      type: getGeneticOrientedTask(type),
      interactionPercentage: Math.floor(Math.random() * 1),
      lastInteraction: Date.now(),
    },
    rankTasks: {},
    geneticalPriority: {
      Protection: Math.random() * 10,
      Exploration: Math.random() * 10,
      Collect: Math.random() * 10,
      Store: Math.random() * 10,
      Expansion: Math.random() * 10,
      Cleaning: Math.random() * 10,
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
    this.setTarget = TASK_POSITIONS[ant.beheviour.actualTask.type]
    this.setNest = new BABYLON.Vector3(0, 0, 0)

    return this
  }

  set setNestCallback(cb) {
    this.data.nestCallback = (id, actualTask, preaviousTask) => cb(id, actualTask, preaviousTask)
  }

  set setReproductionCallback(cb) {
    this.data.reproductionCallback = () => cb(this.data.id)
  }

  set setDisposeCallback(cb) {
    this.data.disposeCallback = () => cb(this.data.id)
  }

  set setNestNeeds(needs) {
    Object.keys(needs).forEach((task) => {
      if (!this.data.beheviour.rankTasks[task]) this.data.beheviour.rankTasks[task] = (needs[task].actual - needs[task].need) * this.data.beheviour.geneticalPriority[task]
    })
    this.data.nestNeeds = needs
  }

  set setTarget(target) {
    this.data.target = target
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
    return this.data.body.position.x === this.data.target.x && this.data.body.position.z === this.data.target.z
  }

  isArrivedToNest() {
    return this.data.body.position.x === this.data.nest.x && this.data.body.position.z === this.data.nest.z
  }

  isOveractingOnActualNeed(need) {
    return this.data.nestNeeds[need].actual + this.data.nestNeeds[need].dedicated_ants >= this.data.nestNeeds[need].need
  }

  getSimulatedValue(task) {
    return (this.data.beheviour.rankTasks[task] += (this.data.nestNeeds[task].actual - this.data.nestNeeds[task].need) * (this.data.beheviour.geneticalPriority[task]))
  }

  simulateRankResult(simulatedImplement) {
    return simulatedImplement <= 99
  }

  minimumAntsPerTask(preaviousTask) {
    return this.data.nestNeeds[preaviousTask].dedicated_ants >= this.data.nestNeeds[preaviousTask].min_dedicated_ants
  }

  shouldSwitchTask(preaviousTask, actualTask) {
    let isNeeded = this.isOveractingOnActualNeed(preaviousTask)
    let willAddValue = !this.isOveractingOnActualNeed(actualTask)
    return isNeeded && willAddValue && this.minimumAntsPerTask(preaviousTask)
  }

  rankingNeeds() {
    Object.keys(this.data.nestNeeds).forEach((need) => {
      if (this.data.beheviour.rankTasks[need] !== 0) {
        let simulatedNeedImplement = this.getSimulatedValue(need)
        if (this.isOveractingOnActualNeed(need)) this.data.beheviour.rankTasks[need] = 0
        if (this.simulateRankResult(simulatedNeedImplement)) {
          this.data.beheviour.rankTasks[need] += simulatedNeedImplement - this.data.beheviour.rankTasks[need]
        } else {
          this.data.beheviour.rankTasks[need] = 99
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
    let shouldSwitchTask = preaviousTask && this.shouldSwitchTask(preaviousTask, actualTask[0])
    this.data.target = shouldSwitchTask ? TASK_POSITIONS[actualTask[0]] : TASK_POSITIONS[preaviousTask]
    this.data.beheviour.actualTask.type = shouldSwitchTask ? actualTask[0] : preaviousTask
    this.data.beheviour.actualTask.interactionPercentage = shouldSwitchTask ? actualTask[1] : this.data.beheviour.actualTask.interactionPercentage
    this.data.beheviour.actualTask.lastInteraction = Date.now()
    return this.data
  }

  live() {
    this.data.body.position = this.data.nest
    this.performTask()
    this.performTaskInterval = setInterval(() => this.performTask(), Math.floor(Math.random() * CHECK_TIME_INTERVAL))
    this.decreseTaskInterval = setInterval(() => this.decreseTasks(), CHECK_TIME_INTERVAL / 1e10)
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
      this.data.nestCallback(this.data.id, this.data.beheviour.actualTask, preaviousTask)
    }
  }

  moveTo() {
    BABYLON.Animation.CreateAndStartAnimation(
      `${this.data.id}-animation`,
      this.data.body,
      'position',
      30,
      CHECK_TIME_INTERVAL / 100 / 1.5,
      this.data.body.position,
      this.data.target,
      BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
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
      if (this.data.beheviour.rankTasks[task] > 10) this.data.beheviour.rankTasks[task] -= 10
    })
  }

  setInfluence(encountredAnt) {
    if (TASKS[this.data.type].indexOf(encountredAnt.data.beheviour.actualTask.type) === -1) return
    if (!this.data.beheviour.rankTasks[encountredAnt.data.beheviour.actualTask.type])
      this.data.beheviour.rankTasks[encountredAnt.data.beheviour.actualTask.type] = encountredAnt.data.beheviour.actualTask.interactionPercentage 
    if (this.data.beheviour.rankTasks[encountredAnt.data.beheviour.actualTask.type] < 99)
      this.data.beheviour.rankTasks[encountredAnt.data.beheviour.actualTask.type] += encountredAnt.data.beheviour.actualTask.interactionPercentage 
  }

  dispose() {
    clearInterval(this.performTaskInterval)
    clearInterval(this.decreseTaskInterval)
    this.data.disposeCallback()
    return
  }
}
