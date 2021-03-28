import { v1 } from 'uuid'
import * as BABYLON from 'babylonjs'
import { createSphere } from '../commons/meshCreator'

// AntTypes : [ {workers: W}, {protector: P} ]

const TASKS = {
  P: ['Protection', 'Exploration', 'Collect', 'Expansion', 'Cleaning'],
  W: ['Collect', 'Store', 'Cleaning', 'Expansion', 'Protection', 'Exploration'],
}
export const CHECK_TIME_INTERVAL = 10e3
export const TASK_POSITIONS = {
  Protection: new BABYLON.Vector3(-100, 0, 100),
  Exploration: new BABYLON.Vector3(-100, 0, -100),
  Collect: new BABYLON.Vector3(100, 0, -100),
  Store: new BABYLON.Vector3(50, -100, -50),
  Expansion: new BABYLON.Vector3(-50, -100, 50),
  Cleaning: new BABYLON.Vector3(100, 0, 100),
}
export const TASK_PRIORITY = {
  Protection: 0.3,
  Exploration: 0.1,
  Collect: 0.5,
  Store: 0.25,
  Expansion: 0.2,
  Cleaning: 0.25,
}

const getGeneticOrientedTask = (type) => TASKS[type][Math.floor(Math.random() * TASKS[type].length)]
const getGeneticMainTask = (type) => (type === 'P' ? TASKS[type][0] : getGeneticOrientedTask(type))
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
    getGeneticMainTask: getGeneticMainTask(type),
    actualTask: {
      type: getGeneticOrientedTask(type),
      interactionPercentage: Math.floor(Math.random() * 1),
      lastInteraction: Date.now(),
    },
    rankTasks: {},
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
      type === 'W' ? 2.5 : 4,
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
    Object.keys(needs).map((task) => (this.data.beheviour.rankTasks[task] = (needs[task].need / needs[task].actual) * 10))
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
    return this.data.body.position.x === this.data.target.x || this.data.body.position.z === this.data.target.z
  }

  isArrivedToNest() {
    return this.data.body.position.x === this.data.nest.x || this.data.body.position.z === this.data.nest.z
  }

  isOveractingOnActualNeed(need) {
    return this.data.nestNeeds[need].actual > this.data.nestNeeds[need].need
  }

  getSimulatedValue(task) {
    return (this.data.beheviour.rankTasks[task] += this.data.nestNeeds[task].need / this.data.nestNeeds[task].actual)
  }

  simulateRankResult(simulatedImplement) {
    return simulatedImplement < 99
  }

  minimumAntsPerTask(preaviousTask) {
    return this.data.nestNeeds[preaviousTask].dedicated_ants > this.data.nestNeeds[preaviousTask].min_dedicated_ants
  }

  shouldSwitchTask(preaviousTask) {
    return preaviousTask && this.minimumAntsPerTask(preaviousTask)
  }

  rankingNeeds() {
    Object.keys(this.data.nestNeeds).forEach((need) => {
      if (this.data.beheviour.rankTasks[need] !== 0) {
        let simulatedNeedImplement = this.getSimulatedValue(need)
        if (this.isOveractingOnActualNeed(need)) this.data.beheviour.rankTasks[need] = 0
        if (this.simulateRankResult(simulatedNeedImplement)) {
          this.data.beheviour.rankTasks[need] = simulatedNeedImplement
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
    this.data.target = this.shouldSwitchTask(preaviousTask) ? TASK_POSITIONS[actualTask[0]] : TASK_POSITIONS[preaviousTask]
    this.data.beheviour.actualTask.type = this.shouldSwitchTask(preaviousTask) ? actualTask[0] : preaviousTask
    this.data.beheviour.actualTask.interactionPercentage = this.shouldSwitchTask(preaviousTask) ? actualTask[1] : this.data.beheviour.actualTask.interactionPercentage
    this.data.beheviour.actualTask.lastInteraction = Date.now()
  }

  live() {
    this.performTask()
    this.performTaskInterval = setInterval(() => this.performTask(), Math.floor(Math.random() * CHECK_TIME_INTERVAL))
    this.decreseTaskInterval = setInterval(() => this.decreseTasks(), CHECK_TIME_INTERVAL / 100)
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
      // sortedRankedTasks.forEach((task, i) => {
      //   this.data.rankTasks[task] = sortedRankedTasks[i][1]
      // })
      this.assignNewTask(preaviousTask, sortedRankedTasks[0])
      this.data.nestCallback(this.data.id, this.data.beheviour.actualTask, preaviousTask)
    }
  }

  moveTo() {
    BABYLON.Animation.CreateAndStartAnimation(
      `${this.data.id}-animation`,
      this.data.body,
      'position',
      30,
      CHECK_TIME_INTERVAL / 200,
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
      if (this.data.beheviour.rankTasks[task] > 10) this.data.beheviour.rankTasks[task] -= 9
    })
  }

  setInfluence(encountredAnt) {
    if (!this.data.beheviour.rankTasks[encountredAnt.data.beheviour.actualTask.type])
      this.data.beheviour.rankTasks[encountredAnt.data.beheviour.actualTask.type] = encountredAnt.data.beheviour.actualTask.interactionPercentage * 0.00001
    if (this.data.beheviour.rankTasks[encountredAnt.data.beheviour.actualTask.type] < 99)
      this.data.beheviour.rankTasks[encountredAnt.data.beheviour.actualTask.type] += encountredAnt.data.beheviour.actualTask.interactionPercentage * 0.00001
  }

  dispose() {
    clearInterval(this.performTaskInterval)
    clearInterval(this.decreseTaskInterval)
    this.data.disposeCallback()
    return
  }
}
