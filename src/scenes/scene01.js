import * as BABYLON from 'babylonjs'
import * as GUI from 'babylonjs-gui'
import { getNewScene, getNewCamera, getNewLight, createLabel, createSimplePanel } from '../commons/helper'
import Ant, { TASK_POSITIONS, SLEEP_POSITION } from '../classes/ant'

const canvas = document.getElementById('renderCanvas')
const MAX_ANTS = 2e2
const REPRODUCTION_ON = false
let start_ants = REPRODUCTION_ON ? Math.round(MAX_ANTS / 2.5) : MAX_ANTS
let ants_arrived_to_the_nest_at_least_once = []
let active_ants = ants_arrived_to_the_nest_at_least_once.length
let latest_generation_ammount = REPRODUCTION_ON ? start_ants : MAX_ANTS
let generations = start_ants / latest_generation_ammount
let ants = []
let baseNeed = {
  urgency: 0,
  actual: 0,
  need: 0,
  min_dedicated_ants: 1, // Math.round((start_ants / 100) * TASK_PRIORITY.whatever),
  dedicated_ants: 1,
}

let NestNeeds = {
  Protection:JSON.parse(JSON.stringify(baseNeed)),
  Exploration:JSON.parse(JSON.stringify(baseNeed)),
  Collect:JSON.parse(JSON.stringify(baseNeed)),
  Store:JSON.parse(JSON.stringify(baseNeed)),
  Cleaning:JSON.parse(JSON.stringify(baseNeed)),
  Expansion:JSON.parse(JSON.stringify(baseNeed)),
  QueenCare:JSON.parse(JSON.stringify(baseNeed)),
  EggLarvePupeaCare:JSON.parse(JSON.stringify(baseNeed)),
}

let needsObj = {}
const UpdateUrgencyes = () => {
  Object.keys(NestNeeds).forEach((needToUpdate) => {
    NestNeeds[needToUpdate].urgency = NestNeeds[needToUpdate].need / NestNeeds[needToUpdate].actual
  })
}
const antBorn = (first, camera, scene) => {
  let type = ['P', 'W', 'W', 'W'][Math.floor(Math.random() * 4)]
  let ant = new Ant(type, camera, scene)

  ant.setNestCallback = (id, task, preaviousTask, addToPreviousTask) => {
    if (ants_arrived_to_the_nest_at_least_once.indexOf(id) === -1) ants_arrived_to_the_nest_at_least_once.push(id)

    active_ants = ants_arrived_to_the_nest_at_least_once.length
    NestNeeds[preaviousTask].dedicated_ants--
    NestNeeds[task.type].dedicated_ants++
    NestNeeds[preaviousTask].actual += addToPreviousTask
    NestNeeds.Collect.need += 0.10
    NestNeeds.QueenCare.need += 0.05
    NestNeeds.EggLarvePupeaCare.need += 0.05

    let totalTasks = Object.keys(TASK_POSITIONS).length
    let random = Math.random()
    let mainGeneratedNeedValue = random < 0.5 ? random : 0.5
    let restGeneratedNeedValue = 1 - (mainGeneratedNeedValue < 1 ? mainGeneratedNeedValue : 1)

    switch (task.type) {
      case 'Protection':
        NestNeeds.Collect.need += mainGeneratedNeedValue 
        NestNeeds.QueenCare.need += restGeneratedNeedValue / (totalTasks / 4)
        NestNeeds.EggLarvePupeaCare.need += restGeneratedNeedValue / (totalTasks / 4)
        break
      case 'Exploration':
        NestNeeds.Protection.need += mainGeneratedNeedValue 
        NestNeeds.QueenCare.need += restGeneratedNeedValue / (totalTasks / 4)
        NestNeeds.EggLarvePupeaCare.need += restGeneratedNeedValue / (totalTasks / 4)
        break
      case 'Collect':
        NestNeeds.Store.need += mainGeneratedNeedValue
        NestNeeds.Expansion.need += restGeneratedNeedValue / totalTasks
        NestNeeds.Cleaning.need += restGeneratedNeedValue / totalTasks
        NestNeeds.Exploration.need += restGeneratedNeedValue / (totalTasks / 2)
        break
      case 'Store':
        NestNeeds.Expansion.need += mainGeneratedNeedValue
        NestNeeds.Exploration.need += restGeneratedNeedValue / (totalTasks / 4)
        NestNeeds.Cleaning.need += restGeneratedNeedValue / (totalTasks / 4)
        break
      case 'Expansion':
        NestNeeds.Cleaning.need += mainGeneratedNeedValue
        NestNeeds.QueenCare.need += restGeneratedNeedValue / totalTasks
        NestNeeds.EggLarvePupeaCare.need += restGeneratedNeedValue / totalTasks
        NestNeeds.Exploration.need += restGeneratedNeedValue / (totalTasks / 2)
        break
      case 'Cleaning':
        NestNeeds.Protection.need += mainGeneratedNeedValue
        NestNeeds.Exploration.need += restGeneratedNeedValue
        break
      case 'QueenCare':
        NestNeeds.Collect.need += mainGeneratedNeedValue
        NestNeeds.Expansion.need += restGeneratedNeedValue
        break
      case 'EggLarvePupeaCare':
        NestNeeds.Expansion.need += mainGeneratedNeedValue
        NestNeeds.Collect.need += restGeneratedNeedValue
        break
      default:
        break
    }
    UpdateUrgencyes()
    ant.setNestNeeds = NestNeeds
  }

  ant.setDisposeCallback = (id) => {
    let filtredAnts = ants.filter((ant) => {
      if (ant.data && ant.data.id === id) ant.data.body.dispose()
      return ant.data && ant.data.id !== id
    })
    start_ants--
    NestNeeds.Expansion.need--
    ants = new Array(filtredAnts)
  }
  ant.setReproductionCallback = (id) => {
    if (ants.length < MAX_ANTS) {
      antBorn(false, camera, scene)
      start_ants++
    }
  }
  ant.totalAntsInNest = MAX_ANTS
  ant.setReproduction = REPRODUCTION_ON
  if (!first) ant.registerCollider(ants)
  NestNeeds.Protection.need += type === 'P' ? 0.05 : 0.03
  NestNeeds.Exploration.need += type === 'P' ? 0.05 : 0.03
  NestNeeds.Expansion.need += type === 'P' ? 0.05 : 0.03
  NestNeeds.Collect.need += 1.0
  NestNeeds.Store.need += type === 'P' ? 0.05 : 0.03
  NestNeeds.Cleaning.need += type === 'P' ? 0.05 : 0.03
  NestNeeds.QueenCare.need += type === 'P' ? 0.5 : 0.10
  NestNeeds.EggLarvePupeaCare.need += type === 'P' ? 0.5 : 0.25
  ants.push(ant)
}

const creatGUI = (test_AdvancedTexture) => {
  const Panel = createSimplePanel({})
  let TitleBox = new GUI.TextBlock('title')
  TitleBox.fontFamily = 'Roboto'
  TitleBox.fontSize = '20px'
  TitleBox.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT
  TitleBox.textVerticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP
  TitleBox.paddingTop = '10px'
  TitleBox.paddingLeft = '10px'
  TitleBox.text = 'Anthill Score'
  TitleBox.height = '30px'
  let textBox = new GUI.TextBlock('score')
  textBox.fontFamily = 'Roboto'
  textBox.fontSize = '13px'
  textBox.textHorizontalAlignment = GUI.Control.HORIZONTAL_ALIGNMENT_LEFT
  textBox.textVerticalAlignment = GUI.Control.VERTICAL_ALIGNMENT_TOP
  textBox.paddingTop = '10px'
  textBox.paddingLeft = '10px'
  textBox.height = '1050px'

  Panel.addControl(TitleBox)
  Panel.addControl(textBox)
  test_AdvancedTexture.addControl(Panel)
  return textBox
}

export const Create = (engine) => {
  const space_size = MAX_ANTS
  const scene = getNewScene(engine)
  const camera = getNewCamera('mainCamera01', scene, canvas, space_size)
  getNewLight('mainLight01', scene)
  const test_AdvancedTexture = GUI.AdvancedDynamicTexture.CreateFullscreenUI('ui1', scene)

  let nestBox = BABYLON.Mesh.CreateBox(`nest-box`, 10, scene)
  nestBox.position = new BABYLON.Vector3.Zero()
  nestBox.checkCollisions = false
  createLabel(test_AdvancedTexture, nestBox, 'Anthill')
  camera.setTarget(nestBox)
  let sleepBox = BABYLON.Mesh.CreateBox(`sleep-box`, 10, scene)
  sleepBox.position = SLEEP_POSITION
  sleepBox.material = new BABYLON.StandardMaterial(`box:sleep`, scene)
  sleepBox.material.diffuseColor = new BABYLON.Color3.Random()
  createLabel(test_AdvancedTexture, sleepBox, 'Sleeping Ants')
  Object.keys(TASK_POSITIONS).forEach((task) => {
    let taskBox = BABYLON.Mesh.CreateBox(`${task}-box`, 5, scene)
    // taskBox.setPivotPoint(new BABYLON.Vector3(0, -2.5, 0))
    taskBox.position = TASK_POSITIONS[task]
    taskBox.checkCollisions = false
    taskBox.material = new BABYLON.StandardMaterial(`box:${task}`, scene)
    taskBox.material.diffuseColor = new BABYLON.Color3.Random()
    needsObj[task] = taskBox
    createLabel(test_AdvancedTexture, taskBox, task)
  })

  for (let i = 0; i < start_ants; i++) {
    antBorn(true, camera, scene)
  }

  ants.forEach((ant) => {
    ant.registerCollider(ants)
    NestNeeds[ant.data.behaviour.actualTask.type].dedicated_ants++
    ant.setNestNeeds = NestNeeds
    ant.live()
  })

  let textBox = creatGUI(test_AdvancedTexture)

  scene.registerBeforeRender(() => {
    Object.keys(needsObj).forEach((needKey) => {
      let { actual, need } = NestNeeds[needKey]
      let isNegative = actual > need
      let scale = actual > 0 ? (need / actual > 10 ? 10 : need / actual < 0 ? 0 : need / actual) : 1
      needsObj[needKey].scaling = new BABYLON.Vector3(1, isNegative ? -scale : scale, 1)
    })
  })

  engine.runRenderLoop(() => {
    if (Math.floor(active_ants / latest_generation_ammount) > 0 && Math.floor(active_ants / latest_generation_ammount) === 2) {
      latest_generation_ammount = latest_generation_ammount * 2
      generations++
    }
    textBox.text = JSON.stringify(
      {
        totalAnts: ants.length,
        active_ants,
        generations,
        ...NestNeeds,
      },
      null,
      2
    )
  })

  return scene
}
