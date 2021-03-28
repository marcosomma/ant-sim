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
    min_dedicated_ants: Math.round((start_ants / 50) * TASK_PRIORITY.Protection),
    dedicated_ants: 0,
  },
  Exploration: {
    actual: 0,
    need: 0,
    min_dedicated_ants: Math.round((start_ants / 50) * TASK_PRIORITY.Exploration),
    dedicated_ants: 0,
  },
  Collect: {
    actual: 0,
    need: 0,
    min_dedicated_ants: Math.round((start_ants / 50) * TASK_PRIORITY.Collect),
    dedicated_ants: 0,
  },
  Store: {
    actual: 0,
    need: 0,
    min_dedicated_ants: Math.round((start_ants / 50) * TASK_PRIORITY.Store),
    dedicated_ants: 0,
  },
  Cleaning: {
    actual: 0,
    need: 0,
    min_dedicated_ants: Math.round((start_ants / 50) * TASK_PRIORITY.Cleaning),
    dedicated_ants: 0,
  },
  Expansion: {
    actual: 0,
    need: 0,
    min_dedicated_ants: Math.round((start_ants / 50) * TASK_PRIORITY.Exploration),
    dedicated_ants: 0,
  },
}

const antBorn = (first, camera, scene) => {
  let type = ['W', 'W', 'P'][Math.floor(Math.random() * 3)]
  let ant = new Ant(type, camera, scene)

  ant.setNestCallback = (id, task, preaviousTask) => {
    if (ants_arrived_to_the_nest_at_least_once.indexOf(id) === -1) {
      ants_arrived_to_the_nest_at_least_once.push(id)
    }
    active_ants = ants_arrived_to_the_nest_at_least_once.length
    NestNeeds[task.type].min_dedicated_ants = Math.round((start_ants / 50) * TASK_PRIORITY[task.type])
    NestNeeds[preaviousTask].dedicated_ants--
    NestNeeds[task.type].dedicated_ants++
    NestNeeds[preaviousTask].actual += 1
    NestNeeds.Collect.need += 0.25
    switch (task.type) {
      case 'Protection':
        NestNeeds.Collect.need += 0.25
        break
      case 'Exploration':
        NestNeeds.Protection.need++
        NestNeeds.Collect.actual += 0.25
        NestNeeds.Store.actual += 0.125
        break
      case 'Collect':
        NestNeeds.Store.need += 0.5
        NestNeeds.Protection.need += 0.5
        NestNeeds.Exploration.need += 0.5
        break
      case 'Store':
        NestNeeds.Expansion.need += 0.25
        break
      case 'Expansion':
        NestNeeds.Cleaning.need += 0.5
        NestNeeds.Exploration.need += 0.5
        break
      case 'Cleaning':
        NestNeeds.Protection.need += 0.5
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
  NestNeeds.Expansion.need += type === 'P' ? 1 : 0.5
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

export const Create = (engine, rootingCallback) => {
  const space_size = MAX_ANTS
  const scene = getNewScene(engine)
  const camera = getNewCamera('mainCamera01', scene, canvas, space_size)
  const light = getNewLight('mainLight01', scene)
  const test_AdvancedTexture = GUI.AdvancedDynamicTexture.CreateFullscreenUI('ui1', scene)

  let taskBox = BABYLON.Mesh.CreateBox(`nest-box`, 0.1, scene)
  taskBox.position = new BABYLON.Vector3.Zero()
  createLabel(test_AdvancedTexture, taskBox, 'Anthill')
  camera.setTarget(taskBox)
  Object.keys(TASK_POSITIONS).forEach((task) => {
    let taskBox = BABYLON.Mesh.CreateBox(`${task}-box`, 0.1, scene)
    taskBox.position = TASK_POSITIONS[task]
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

  scene.registerBeforeRender(() => {})

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
