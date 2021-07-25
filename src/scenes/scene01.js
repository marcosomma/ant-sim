import * as BABYLON from 'babylonjs'
import * as GUI from 'babylonjs-gui'
import { getNewScene, getNewCamera, getNewLight, createLabel, createSimplePanel, isEven } from '../commons/helper'
import Ant, { TASK_POSITIONS, TASK_PRIORITY } from '../classes/ant'

const canvas = document.getElementById('renderCanvas')
const MAX_ANTS = 200
const REPRODUCTION_ON = false
let start_ants = REPRODUCTION_ON ? Math.round(MAX_ANTS / 2.5) : MAX_ANTS
let ants_arrived_to_the_nest_at_least_once = []
let active_ants = ants_arrived_to_the_nest_at_least_once.length
let latest_generation_ammount = REPRODUCTION_ON ? start_ants : MAX_ANTS
let generations = start_ants / latest_generation_ammount
let ants = []

let NestNeeds = {
  Protection: {
    actual: 0,
    need: 0,
    min_dedicated_ants: Math.round((start_ants / 100) * TASK_PRIORITY.Protection),
    dedicated_ants: 0,
  },
  Exploration: {
    actual: 0,
    need: 0,
    min_dedicated_ants: Math.round((start_ants / 100) * TASK_PRIORITY.Exploration),
    dedicated_ants: 0,
  },
  Collect: {
    actual: 0,
    need: 0,
    min_dedicated_ants: Math.round((start_ants / 100) * TASK_PRIORITY.Collect),
    dedicated_ants: 0,
  },
  Store: {
    actual: 0,
    need: 0,
    min_dedicated_ants: Math.round((start_ants / 100) * TASK_PRIORITY.Store),
    dedicated_ants: 0,
  },
  Cleaning: {
    actual: 0,
    need: 0,
    min_dedicated_ants: Math.round((start_ants / 100) * TASK_PRIORITY.Cleaning),
    dedicated_ants: 0,
  },
  Expansion: {
    actual: 0,
    need: 0,
    min_dedicated_ants: Math.round((start_ants / 100) * TASK_PRIORITY.Exploration),
    dedicated_ants: 0,
  },
}

let needsObj = {}

const antBorn = (first, camera, scene) => {
  let type = ['W', 'W', 'P'][Math.floor(Math.random() * 3)]
  let ant = new Ant(type, camera, scene)

  ant.setNestCallback = (id, task, preaviousTask) => {
    if (ants_arrived_to_the_nest_at_least_once.indexOf(id) === -1) {
      ants_arrived_to_the_nest_at_least_once.push(id)
    }
    active_ants = ants_arrived_to_the_nest_at_least_once.length
    NestNeeds[task.type].min_dedicated_ants = Math.round((start_ants / 100) * TASK_PRIORITY[task.type])
    NestNeeds[preaviousTask].dedicated_ants--
    NestNeeds[task.type].dedicated_ants++
    NestNeeds[preaviousTask].actual += 1
    let random = Math.random()
    let mainGeneratedNeedValue = (random < 0.5 ? random : 0.5)
    let restGeneratedNeedValue = (1 - (mainGeneratedNeedValue < 1 ? mainGeneratedNeedValue : 1)) 
    switch (task.type) {
      case 'Protection':
        NestNeeds.Collect.need += mainGeneratedNeedValue + restGeneratedNeedValue
        break
      case 'Exploration':
        NestNeeds.Protection.need += mainGeneratedNeedValue + restGeneratedNeedValue
        break
      case 'Collect':
        NestNeeds.Store.need += mainGeneratedNeedValue
        NestNeeds.Protection.need += restGeneratedNeedValue/6
        NestNeeds.Cleaning.need += restGeneratedNeedValue/6
        NestNeeds.Exploration.need += restGeneratedNeedValue/3
        break
      case 'Store':
        NestNeeds.Expansion.need += mainGeneratedNeedValue
        NestNeeds.Exploration.need += restGeneratedNeedValue/2
        NestNeeds.Cleaning.need += restGeneratedNeedValue/2
        break
      case 'Expansion':
        NestNeeds.Exploration.need += restGeneratedNeedValue
        NestNeeds.Cleaning.need += mainGeneratedNeedValue
        break
      case 'Cleaning':
        NestNeeds.Protection.need += mainGeneratedNeedValue
        NestNeeds.Exploration.need += restGeneratedNeedValue
        break

      default:
        break
    }
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
  ant.setReproduction = REPRODUCTION_ON
  if (!first) ant.registerCollider(ants)
  NestNeeds.Expansion.need += type === 'P' ? 0.5 : 0.25
  NestNeeds.Exploration.need += type === 'P' ? 0.5 : 0.25
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
  textBox.paddingTop = '50px'
  textBox.paddingLeft = '10px'
  textBox.height = '750px'

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
  Object.keys(TASK_POSITIONS).forEach((task) => {
    let taskBox = BABYLON.Mesh.CreateBox(`${task}-box`, 5, scene)
    taskBox.setPivotPoint(new BABYLON.Vector3(0, -2.5, 0));
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
    NestNeeds[ant.data.beheviour.actualTask.type].dedicated_ants++
    ant.setNestNeeds = NestNeeds
    ant.live()
  })

  let textBox = creatGUI(test_AdvancedTexture)

  scene.registerBeforeRender(() => {
    Object.keys(needsObj).forEach(needKey => {
      let {actual, need } = NestNeeds[needKey]
      let scale = need/actual > 10 ? 10 : need/actual < 0.5 ? 0.5: need/actual
      needsObj[needKey].scaling = new BABYLON.Vector3(1,scale,1)

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
