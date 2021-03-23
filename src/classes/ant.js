import { v1 } from 'uuid'
import * as BABYLON from 'babylonjs'
import { createSphere } from '../commons/meshCreator'

// AntTypes : [ {workers: W}, {protector: P} ]

const TASKS = {
  P: ['Protection', 'Exploration', 'Collect', 'Cleaning', 'Expansion'],
  W: ['Collect', 'Exploration', 'Store', 'Cleaning', 'Expansion'],
}
const TIME_INTERVAL = 10e3
export const TASK_POSITIONS = {
  Protection: new BABYLON.Vector3(-100, 0, 100),
  Exploration: new BABYLON.Vector3(-100, 0, -100),
  Collect: new BABYLON.Vector3(100, 0, -100),
  Store: new BABYLON.Vector3(50, -100, -50),
  Expansion: new BABYLON.Vector3(-50, -100, 50),
  Cleaning: new BABYLON.Vector3(100, 0, 100),
}

const getGeneticOrientedTask = (type) => TASKS[type][Math.floor(Math.random() * TASKS[type].length)]
const getGeneticMainTask = (type) => TASKS[type][0]

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

    ant.reproductionTime = Math.floor(Math.random() * 30e3) + 30e3
    ant.lifeTime = Math.floor(Math.random() * 10e3) + ant.reproductionTime
    ant.body.position = new BABYLON.Vector3(0, Math.random() * 5, 0)
    this.data = ant
    this.reportedCollision = false
    this.setTarget = TASK_POSITIONS[ant.beheviour.actualTask.type]
    this.setNest = new BABYLON.Vector3(0, Math.random() * 5, 0)

    return this
  }

  live() {
    this.performTask()
    this.performTaskInterval = setInterval(
      () => this.performTask(),
      Math.floor(Math.random() * TIME_INTERVAL)
    )
    this.decreseTaskInterval = setInterval(() => this.decreseTasks(), 1e3)
  }

  performTask() {
    const lifeTime = Math.ceil(Math.abs(Date.now() - this.data.bornAt))
    if (lifeTime >= this.data.lifeTime) {
      return this.dispose()
    }
    if (lifeTime >= this.data.reproductionTime && this.data.cloned === false) {
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
      TIME_INTERVAL / 200,
      this.data.body.position,
      this.data.target,
      BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
    )
  }

  findNewScope() {
    if (
      this.data.body.position.x !== this.data.nest.x ||
      this.data.body.position.z !== this.data.nest.z
    ) {
      this.setTarget = this.data.nest
      this.moveTo()
    } else {
      let sortedRankedTasks = []

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
                  : 1 < 99)
            ) {
              this.data.beheviour.rankTasks[need] +=
                (this.data.nestNeeds[need].need / this.data.nestNeeds[need].actual) * need ===
                this.data.beheviour.getGeneticMainTask
                  ? 10
                  : 1
            } else {
              this.data.beheviour.rankTasks[need] = 100
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

      this.data.nestCallback(this.data.beheviour.actualTask)

      this.data.target = TASK_POSITIONS[sortedRankedTasks[0][0]]
      this.data.beheviour.actualTask.type = sortedRankedTasks[0][0]
      this.data.beheviour.actualTask.interactionPercentage = sortedRankedTasks[0][1]
      this.data.beheviour.actualTask.lastInteraction = Date.now()
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
      if (this.data.beheviour.rankTasks[task] > 1) this.data.beheviour.rankTasks[task] -= 1
    })
  }

  setInfluence(encountredAnt) {
    if (
      (this.data.type === 'W' && encountredAnt.data.beheviour.actualTask.type === 'Protection') ||
      (this.data.type === 'P' && encountredAnt.data.beheviour.actualTask.type === 'Store')
    )
      return
    if (!this.data.beheviour.rankTasks[encountredAnt.data.beheviour.actualTask.type])
      this.data.beheviour.rankTasks[encountredAnt.data.beheviour.actualTask.type] =
        encountredAnt.data.beheviour.actualTask.interactionPercentage
    if (this.data.beheviour.rankTasks[encountredAnt.data.beheviour.actualTask.type] < 100)
      this.data.beheviour.rankTasks[encountredAnt.data.beheviour.actualTask.type] +=
        encountredAnt.data.beheviour.actualTask.interactionPercentage * 0.1
  }

  dispose() {
    clearInterval(this.performTaskInterval)
    clearInterval(this.decreseTaskInterval)
    this.data.disposeCallback()
    this.data.body.dispose()
    return
  }

  set setNestCallback(cb) {
    this.data.nestCallback = (actualTask) => cb(actualTask)
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
}
