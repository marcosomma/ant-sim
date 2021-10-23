import * as BABYLON from 'babylonjs'
import { createSphere } from '../commons/meshCreator'
import {
  MAX_ANTS,
  PHYSICS_VALUE,
  INCERESE_MAIN_TASK,
  NEG_TARGET_MATCH,
  POS_TARGET_MATCH,
  NEG_DICSOVERED_TARGET_MATCH,
  POS_DICSOVERED_TARGET_MATCH,
  AUTODISCOVERING,
  ANT_INFLUENCE_FACTOR,
  MIN_CHECK_TIME_INTERVAL,
  CHECK_TIME_INTERVAL,
  TASKS,
  SLEEP_POSITION,
  TASK_POSITIONS,
  getReproductionTime,
  getRandomTarget,
  getAntObject,
  getPerformTaskInternal,
  getDecreseInternal,
  getSleepingInterval,
} from '../commons/contants'

export default class Ant {
  constructor(type, camera, scene) {
    let ant = new Object(getAntObject(type))
    let randomColor = new BABYLON.Color3(Math.random() * 1, Math.random() * 1, Math.random() * 1)
    ant.reproductionTime = getReproductionTime()
    ant.lifeTime = Math.floor(Math.random() * -ant.reproductionTime + ant.reproductionTime) + ant.reproductionTime
    ant.babylonElements = {
      scene,
      camera,
    }
    ant.body = createSphere({ id: ant.id, name: `${type} - ${ant.id}` }, type === 'W' ? MAX_ANTS / 2e2 : MAX_ANTS / 125, 12, randomColor, camera, scene)
    ant.body.position = new BABYLON.Vector3(0, 0, 0)
    ant.body.material = new BABYLON.StandardMaterial(`ant:${type} - ${ant.id}`, scene)
    ant.body.material.diffuseColor = randomColor

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
    return lifeTime > this.data.lifeTime && this.data.reproducrionOn
  }

  isReproductionTime() {
    const lifeTime = Math.ceil(Math.abs(Date.now() - this.data.bornAt))
    return lifeTime >= this.data.reproductionTime && this.data.reproducrionOn && !this.data.cloned
  }

  hadDiscoveredAllTargets() {
    return Object.keys(this.data.behaviour.discoveredPositions).filter((task) => this.data.behaviour.discoveredPositions[task] === false).length === 0
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
    if(this.hadDiscoveredAllTargets()){
      this.data.body.material.emissiveColor = new BABYLON.Color3.White()
    }
    this.data.behaviour.actualTask.type = shouldSwitchTask ? currentTask : preaviousTask
    this.data.behaviour.actualTask.interactionPercentage = shouldSwitchTask ? actualTask[1] : this.data.behaviour.actualTask.interactionPercentage
    this.data.behaviour.actualTask.lastInteraction = Date.now()
    return this.data
  }

  goToSleep() {
    this.data.animation.pause()
    this.isSleeping = true
    this.data.body.position = new BABYLON.Vector3(SLEEP_POSITION.x, SLEEP_POSITION.y - (Math.random() * 1e2 + 6), 0)
    this.data.body.physicsImpostor.dispose()
    this.awakeTime = setInterval(() => this.awake(), CHECK_TIME_INTERVAL / 24e3)
  }

  awake() {
    this.data.body.position = new BABYLON.Vector3(0, 0, 0)
    this.isSleeping = false
    this.data.body.physicsImpostor = new BABYLON.PhysicsImpostor(this.data.body, BABYLON.PhysicsImpostor.SphereImpostor, PHYSICS_VALUE, this.data.babylonElements.scene)
    this.moveTo()
    clearInterval(this.awakeTime)
  }

  live() {
    this.data.body.position = this.data.nest
    this.moveTo()

    this.checkTaskInterval = setInterval(() => (!this.isSleeping ? this.check() : null), getPerformTaskInternal())
    this.sleep = setInterval(() => (!this.isSleeping ? this.goToSleep() : null), getSleepingInterval())
    this.decreseTaskInterval = setInterval(() => this.decreseTasks(), getDecreseInternal())
  }

  check() {
    if (this.isEndOfLife()) {
      return this.dispose()
    }
    if (this.isReproductionTime()) {
      this.data.cloned === true
      this.data.reproductionCallback(this.data.id)
    }
  }

  findNewScope() {
    if (!this.isArrivedToNest()) {
      this.setTarget = this.data.nest
      return
    } else {
      if (this.data.nestNeeds) this.rankingNeeds()
      let preaviousTask = this.data.behaviour.actualTask.type
      let sortedRankedTasks = this.getSortedRankTasks([])
      let nextTask = preaviousTask === sortedRankedTasks[0][0] ? sortedRankedTasks[1] : sortedRankedTasks[0]
      let calculatedIncreseValue = this.data.behaviour.discoveredPositions[preaviousTask] ? INCERESE_MAIN_TASK * this.data.behaviour.geneticalPriority[preaviousTask] : 0

      this.assignNewTask(preaviousTask, nextTask)
      this.data.nestCallback(this.data.id, this.data.behaviour.actualTask, preaviousTask, calculatedIncreseValue)
    }
  }

  moveTo() {
    this.data.animation = BABYLON.Animation.CreateAndStartAnimation(
      `${this.data.id}-animation`,
      this.data.body,
      'position',
      60,
      Math.floor((Math.random() * (CHECK_TIME_INTERVAL - MIN_CHECK_TIME_INTERVAL) + MIN_CHECK_TIME_INTERVAL) / 60),
      this.data.body.position,
      this.data.target,
      BABYLON.Animation.ANIMATIONLOOPMODE_RELATIVE,
      null,
      () => {
        if (this.isSleeping) return
        if (this.isArrivedToTarget()) {
          this.findNewScope()
        }
        this.moveTo()
      }
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
    console.log('------ die')
    clearInterval(this.checkTaskInterval)
    clearInterval(this.sleep)
    clearInterval(this.decreseTaskInterval)
    this.data.body.dispose()
    this.data.disposeCallback()
    return
  }
}
