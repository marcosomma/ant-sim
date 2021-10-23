import { v1 } from 'uuid'

export const PHYSICS_VALUE = { mass: .1, restitution: .05}
export const MAX_ANTS = 3e2
export const INCERESE_MAIN_TASK = 0.55
export const NEG_TARGET_MATCH = -0.5
export const POS_TARGET_MATCH = 0.5
export const NEG_DICSOVERED_TARGET_MATCH = -20
export const POS_DICSOVERED_TARGET_MATCH = 20
export const SEARCHING_RADIUS = MAX_ANTS / 10
export const AUTODISCOVERING = true
export const REPRODUCTION_ON = false
export const ANT_INFLUENCE_FACTOR = Math.random() / 1e6
export const MIN_CHECK_TIME_INTERVAL = 30e3
export const CHECK_TIME_INTERVAL = Math.random() * (90e3 - MIN_CHECK_TIME_INTERVAL) + MIN_CHECK_TIME_INTERVAL
export const TASKS = {
  P: ['Protection', 'Store', 'Cleaning', 'Expansion', 'Exploration', 'QueenCare', 'EggLarvePupeaCare'],
  W: ['Collect', 'Store', 'Cleaning', 'Expansion', 'Exploration', 'QueenCare', 'EggLarvePupeaCare'],
}
const getRandomPos = () => Math.random() * (SEARCHING_RADIUS * (Math.PI * 1.35) - SEARCHING_RADIUS/2) + SEARCHING_RADIUS/2
export const SLEEP_POSITION = new BABYLON.Vector3(-SEARCHING_RADIUS * (Math.PI * 2), SEARCHING_RADIUS * Math.PI , 0)
export const TASK_POSITIONS = {
  Store: new BABYLON.Vector3(-getRandomPos(), getRandomPos(), -getRandomPos()),
  Exploration: new BABYLON.Vector3(-getRandomPos(), getRandomPos(), -getRandomPos()),
  Collect: new BABYLON.Vector3(getRandomPos(), -getRandomPos(), getRandomPos()),
  Protection: new BABYLON.Vector3(getRandomPos(), -getRandomPos(), getRandomPos()),
  Expansion: new BABYLON.Vector3(-getRandomPos(), -getRandomPos(), getRandomPos()),
  Cleaning: new BABYLON.Vector3(getRandomPos(), getRandomPos(), -getRandomPos()),
  QueenCare: new BABYLON.Vector3(-getRandomPos(), getRandomPos(), -getRandomPos()),
  EggLarvePupeaCare: new BABYLON.Vector3(getRandomPos(), -getRandomPos(), getRandomPos()),
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

export const getDecreseInternal = () => CHECK_TIME_INTERVAL / 1e3 > 0.1 ? CHECK_TIME_INTERVAL / 1e3 : 0.1
export const getPerformTaskInternal = () => Math.floor(Math.random() * CHECK_TIME_INTERVAL)
export const getSleepingInterval = () => CHECK_TIME_INTERVAL + Math.random() * CHECK_TIME_INTERVAL + CHECK_TIME_INTERVAL * Math.floor(Math.random() * 24)
export const getRandomArbitrary = (min, max) => Math.random() * (max - min) + min
export const randomPointInRadius = (positive) => Math.random() * (positive ? SEARCHING_RADIUS : -SEARCHING_RADIUS) * (Math.PI * 2)
export const getGeneticOrientedTask = (type) => TASKS[type][Math.floor(Math.random() * TASKS[type].length)]
export const getReproductionTime = () => REPRODUCTION_ON ? Math.floor(Math.random() * CHECK_TIME_INTERVAL * 30) : 0
export const getRandomTarget = () =>
  new BABYLON.Vector3(getRandomArbitrary(randomPointInRadius(false), randomPointInRadius(true)), getRandomArbitrary(randomPointInRadius(false), randomPointInRadius(true)), getRandomArbitrary(randomPointInRadius(false), randomPointInRadius(true)))

export const getSize = (type) => {
  switch (type) {
    case 'P':
      return 'big'
    default:
      return 'small'
  }
}

export const getAntObject = (type) => ({
  id: v1(),
  type,
  size: getSize(type),
  bornAt: Date.now(),
  cloned: false,
  animation: null,
  awakeTime: null,
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