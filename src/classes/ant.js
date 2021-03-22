import uuid from 'uuid'
import * as BABYLON from 'babylonjs'
import { createSphere } from '../commons/meshCreator'

// AntTypes : [ {workers: W}, {protector: P} ]

const TASKS = { P: ['perimetral'], W: ['explore', 'collect', 'store', 'cleaning'] }
export const TASK_POSITIONS = {
  perimetral: new BABYLON.Vector3(-200, 0, -100),
  explore: new BABYLON.Vector3(-Math.random() * 200, 0, -Math.random() * 200),
  collect: new BABYLON.Vector3(-200, 0, -200),
  store: new BABYLON.Vector3(10, -100, 10),
  cleaning: new BABYLON.Vector3(-Math.random() * 40, 0, -Math.random() * 40),
}

const getGeneticOrientedTask = (type) => TASKS[type][Math.floor(Math.random() * TASKS[type].length)]

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
      id: uuid.v1(),
      type,
      size: getSize(type),
      beheviour: {
        geneticOrientedTask: getGeneticOrientedTask(type),
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

    ant.body.position = new BABYLON.Vector3(0, Math.random() * 5, 0)
    this.data = ant
    this.reportedCollision = false
    this.setTarget = TASK_POSITIONS[ant.beheviour.actualTask.type]
    this.setNest = new BABYLON.Vector3(0, Math.random() * 5, 0)

    return this
  }

  live() {
    this.performTask()
    setInterval(() => this.performTask(), Math.floor(Math.random() * 6e3))
    setInterval(() => this.decreseTasks(), 1e3)
  }

  performTask() {
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
      150,
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
          if (
            this.data.nestNeeds[need].actual === this.data.nestNeeds[need].need &&
            this.data.beheviour.rankTasks[need] !== 0
          ) {
            this.data.beheviour.rankTasks[need] = 0
          }
        })
      }

      Object.keys(this.data.beheviour.rankTasks).map((task) => {
        sortedRankedTasks.push([task, this.data.beheviour.rankTasks[task]])
      })

      sortedRankedTasks.sort(function (a, b) {
        return a[1] - b[1]
      })

      if (this.data.nestCallback) this.data.nestCallback()

      if (sortedRankedTasks.length) {
        this.data.target = TASK_POSITIONS[sortedRankedTasks[0][0]]
        this.data.beheviour.actualTask.task = sortedRankedTasks[0][0]
        this.data.beheviour.actualTask.interactionPercentage = sortedRankedTasks[0][1]
        this.data.beheviour.actualTask.lastInteraction = Date.now()
      }
    }
  }

  registerCollider(list) {
    this.data.babylonElements.scene.registerBeforeRender(() => {
      list.forEach((element) => {
        if (this.data.body.intersectsMesh(element.data.body, true) && !this.reportedCollision) {
          this.setInfluence(element)
          this.reportedCollision = true
        } else {
          this.reportedCollision = false
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
    if (this.data.type === 'W' && encountredAnt.data.beheviour.actualTask.type === 'perimetral')
      return
    if (!this.data.beheviour.rankTasks[encountredAnt.data.beheviour.actualTask.type])
      this.data.beheviour.rankTasks[encountredAnt.data.beheviour.actualTask.type] =
        encountredAnt.data.beheviour.actualTask.interactionPercentage
    if (this.data.beheviour.rankTasks[encountredAnt.data.beheviour.actualTask.type] < 100)
      this.data.beheviour.rankTasks[encountredAnt.data.beheviour.actualTask.type] +=
        encountredAnt.data.beheviour.actualTask.interactionPercentage * 0.001
  }

  set setNestCallback(cb) {
    this.data.nestCallback = () => cb(this.data.beheviour.actualTask)
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
