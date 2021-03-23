import * as BABYLON from 'babylonjs'
import * as GUI from 'babylonjs-gui'
import {
  getNewScene,
  getNewCamera,
  getNewLight,
  createLabel,
  createSimplePanel,
} from '../commons/helper'
import Ant, { TASK_POSITIONS, TASK_PRIORITY } from '../classes/ant'

const canvas = document.getElementById('renderCanvas')
const MAX_ANTS = 250
const REPRODUCTION_ON = false
let start_ants = REPRODUCTION_ON ? Math.round(MAX_ANTS / 100) : MAX_ANTS
let ants_arrived_to_the_nest_at_least_once = []
let active_ants = ants_arrived_to_the_nest_at_least_once.length
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
  let type = ['W', 'W', 'P', 'W', 'W', 'P'][Math.floor(Math.random() * 6)]
  let ant = new Ant(type, camera, scene)

  ant.setNestCallback = (id, task, preaviousTask) => {
    if (ants_arrived_to_the_nest_at_least_once.indexOf(id) === -1) {
      ants_arrived_to_the_nest_at_least_once.push(id)
    }
    active_ants = ants_arrived_to_the_nest_at_least_once.length
    NestNeeds[task.type].min_dedicated_ants = Math.round(
      (start_ants / 50) * TASK_PRIORITY[task.type]
    )
    if (preaviousTask !== task.type) {
      if (NestNeeds[preaviousTask].dedicated_ants > 0) NestNeeds[preaviousTask].dedicated_ants -= 1
    }
    NestNeeds[task.type].dedicated_ants += 1
    NestNeeds[preaviousTask].actual += 1
    NestNeeds.Collect.need += 0.25
    switch (task.type) {
      case 'Protection':
        NestNeeds.Collect.need += 0.25
        break
      case 'Exploration':
        NestNeeds.Protection.need += 1
        NestNeeds.Collect.actual += 0.25
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
      return ant.data.id !== id
    })
    ants = filtredAnts
    NestNeeds.Expansion.need -= 1
    start_ants -= 1
  }
  ant.setReproductionCallback = (id) => {
    if (ants.length < MAX_ANTS) {
      antBorn(false, camera, scene)
      start_ants += 1
    }
  }
  ant.setNestNeeds = NestNeeds
  ant.setReproduction = REPRODUCTION_ON
  ant.live()
  if (!first) ant.registerCollider(ants)
  ants.push(ant)
  NestNeeds.Expansion.need += 1
}

const creatGUI = (test_AdvancedTexture) => {
  const Panel = createSimplePanel({})
  let TitleBox = new GUI.TextBlock('title')
  TitleBox.textWrapping = GUI.TextWrapping.WordWrap
  TitleBox.fontFamily = 'Roboto'
  TitleBox.fontSize = '20px'
  TitleBox.textHorizontalAlignment = 0
  TitleBox.textVerticalAlignment = 0
  TitleBox.paddingTop = 10
  TitleBox.paddingLeft = 10
  TitleBox.text = 'Anthill Score'
  let textBox = new GUI.TextBlock('score')
  textBox.textWrapping = GUI.TextWrapping.WordWrap
  textBox.fontFamily = 'Roboto'
  textBox.fontSize = '13px'
  textBox.textHorizontalAlignment = 0
  textBox.textVerticalAlignment = 0
  textBox.paddingTop = 50
  textBox.paddingLeft = 10

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
  })

  let textBox = creatGUI(test_AdvancedTexture)

  scene.registerBeforeRender(() => {})

  engine.runRenderLoop(() => {
    textBox.text = JSON.stringify(
      {
        totalAnts: ants.length,
        active_ants,
        inactive_ants: start_ants - active_ants,
        ...NestNeeds,
      },
      null,
      2
    )
  })

  return scene
}
