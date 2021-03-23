import { v1 } from 'uuid'
import * as BABYLON from 'babylonjs'
import { createSphere } from '../commons/meshCreator'

// AntTypes : [ {workers: W}, {protector: P} ]

const TASKS = {
  P: ['Protection', 'Exploration', 'Collect'],
  W: ['Collect', 'Store', 'Cleaning', 'Expansion'],
}
export const CHECK_TIME_INTERVAL = 5e3
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

const getSize = (type) => {
  switch (type) {
    case 'P':
      return 'big'
    default:
      return 'small'
  }
}

export default class Ant {
  constructor(type, camera, scene) {
    let ant = {
      id: v1(),
      type,
      size: getSize(type),
      bornAt: Date.now(),
      cloned: false,
      reproducrionOn: true,
      beheviour: {
        getGeneticMainTask: getGeneticMainTask(type),
        actualTask: {
          type: getGeneticOrientedTask(type),
          interactionPercentage: Math.floor(Math.random() * 49),
          lastInteraction: Date.now(),
        },
        rankTasks: {},
      },
      babylonElements: {
        scene,
        camera,
      },
    }

    ant.body = createSphere(
      { id: ant.id, name: `${type} - ${ant.id}` },
      type === 'W' ? 2.5 : 4,
      12,
      new BABYLON.Color3(Math.random() * 1, Math.random() * 1, Math.random() * 1),
      camera,
      scene
    )

    ant.reproductionTime =
      Math.floor(Math.random() * CHECK_TIME_INTERVAL * 5) + CHECK_TIME_INTERVAL * 5
    ant.lifeTime = Math.floor(Math.random() * ant.reproductionTime) + ant.reproductionTime
    ant.body.position = new BABYLON.Vector3(0, 0, 0)
    this.data = ant
    this.reportedCollision = false
    this.setTarget = TASK_POSITIONS[ant.beheviour.actualTask.type]
    this.setNest = new BABYLON.Vector3(0, 0, 0)

    return this
  }

  live() {
    this.performTask()
    this.performTaskInterval = setInterval(
      () => this.performTask(),
      Math.floor(Math.random() * CHECK_TIME_INTERVAL)
    )
    this.decreseTaskInterval = setInterval(() => this.decreseTasks(), CHECK_TIME_INTERVAL / 100)
  }

  performTask() {
    const lifeTime = Math.ceil(Math.abs(Date.now() - this.data.bornAt))
    if (lifeTime >= this.data.lifeTime && this.data.reproducrionOn) {
      return this.dispose()
    }
    if (lifeTime >= this.data.reproductionTime && this.data.reproducrionOn && !this.data.cloned) {
      this.data.cloned === true
      return this.data.reproductionCallback(this.data.id)
    }
    if (
      this.data.body.position.x !== this.data.target.x ||
      this.data.body.position.z !== this.data.target.z
    ) {
      this.moveTo()
    } else {
      this.findNewScope()
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

  findNewScope() {
    let sortedRankedTasks = []
    let preaviousTask = this.data.beheviour.getGeneticMainTask
    if (
      this.data.body.position.x !== this.data.nest.x ||
      this.data.body.position.z !== this.data.nest.z
    ) {
      this.setTarget = this.data.nest
      this.moveTo()
      return
    } else {
      preaviousTask = (' ' + this.data.beheviour.actualTask.type).slice(1)

      if (this.data.nestNeeds) {
        Object.keys(this.data.nestNeeds).forEach((need) => {
          if (this.data.beheviour.rankTasks[need] !== 0) {
            if (this.data.nestNeeds[need].actual > this.data.nestNeeds[need].need)
              this.data.beheviour.rankTasks[need] = 0
            if (
              (this.data.beheviour.rankTasks[need] +=
                (this.data.nestNeeds[need].need / this.data.nestNeeds[need].actual) * need ===
                this.data.beheviour.getGeneticMainTask
                  ? 10
                  : 2 < 99)
            ) {
              this.data.beheviour.rankTasks[need] +=
                (this.data.nestNeeds[need].need / this.data.nestNeeds[need].actual) * need ===
                this.data.beheviour.getGeneticMainTask
                  ? 10
                  : 2
            } else {
              this.data.beheviour.rankTasks[need] = 99
            }
          }
        })
      }

      Object.keys(this.data.beheviour.rankTasks).map((task) => {
        sortedRankedTasks.push([task, this.data.beheviour.rankTasks[task]])
      })

      sortedRankedTasks.sort(function (a, b) {
        return b[1] - a[1]
      })

      // this.data.target = TASK_POSITIONS[sortedRankedTasks[0][0]]
      // this.data.beheviour.actualTask.type = sortedRankedTasks[0][0]
      // this.data.beheviour.actualTask.interactionPercentage = sortedRankedTasks[0][1]
      // this.data.beheviour.actualTask.lastInteraction = Date.now()

      this.data.target = preaviousTask
        ? this.data.nestNeeds[preaviousTask].dedicated_ants <= 0 &&
          this.data.nestNeeds[preaviousTask].dedicated_ants >
            this.data.nestNeeds[preaviousTask].min_dedicated_ants
          ? TASK_POSITIONS[sortedRankedTasks[0][0]]
          : TASK_POSITIONS[preaviousTask]
        : TASK_POSITIONS[sortedRankedTasks[0][0]]
      this.data.beheviour.actualTask.type = preaviousTask
        ? this.data.nestNeeds[preaviousTask].dedicated_ants <= 0 &&
          this.data.nestNeeds[preaviousTask].dedicated_ants >
            this.data.nestNeeds[preaviousTask].min_dedicated_ants
          ? sortedRankedTasks[0][0]
          : preaviousTask
        : sortedRankedTasks[0][0]
      this.data.beheviour.actualTask.interactionPercentage = preaviousTask
        ? this.data.nestNeeds[preaviousTask].dedicated_ants <= 0 &&
          this.data.nestNeeds[preaviousTask].dedicated_ants >
            this.data.nestNeeds[preaviousTask].min_dedicated_ants
          ? sortedRankedTasks[0][1]
          : this.data.beheviour.actualTask.interactionPercentage
        : sortedRankedTasks[0][1]
      this.data.beheviour.actualTask.lastInteraction = Date.now()

      this.data.nestCallback(this.data.id, this.data.beheviour.actualTask, preaviousTask)
    }
  }

  registerCollider(list) {
    this.data.babylonElements.scene.registerBeforeRender(() => {
      list.forEach((element) => {
        if (this.data.body.intersectsMesh(element.data.body, true)) {
          this.setInfluence(element)
          this.reportedCollision = true
        }
      })
    })
  }

  decreseTasks() {
    Object.keys(this.data.beheviour.rankTasks).map((task) => {
      if (this.data.beheviour.rankTasks[task] > 10) this.data.beheviour.rankTasks[task] -= 5
    })
  }

  setInfluence(encountredAnt) {
    if (TASKS[this.data.type].indexOf(encountredAnt.data.beheviour.actualTask.type) === -1) return
    if (!this.data.beheviour.rankTasks[encountredAnt.data.beheviour.actualTask.type])
      this.data.beheviour.rankTasks[encountredAnt.data.beheviour.actualTask.type] =
        encountredAnt.data.beheviour.actualTask.interactionPercentage * 0.00001
    if (this.data.beheviour.rankTasks[encountredAnt.data.beheviour.actualTask.type] < 100)
      this.data.beheviour.rankTasks[encountredAnt.data.beheviour.actualTask.type] +=
        encountredAnt.data.beheviour.actualTask.interactionPercentage * 0.00001
  }

  dispose() {
    clearInterval(this.performTaskInterval)
    clearInterval(this.decreseTaskInterval)
    this.data.disposeCallback()
    this.data.body.dispose()
    return
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
}
