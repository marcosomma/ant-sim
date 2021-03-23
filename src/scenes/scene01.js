import * as BABYLON from 'babylonjs'
import * as GUI from 'babylonjs-gui'
import {
  getNewScene,
  getNewCamera,
  getNewLight,
  createLabel,
  createSimplePanel,
  getTextBox,
} from '../commons/helper'
import Ant, { TASK_POSITIONS } from '../classes/ant'

const canvas = document.getElementById('renderCanvas')

export const registerEventListener = () => {
  console.log('registring events')
}
const MAX_ANTS = 250

let ants = []

let NestNeeds = {
  Protection: {
    actual: 0,
    need: 0,
  },
  Exploration: {
    actual: 0,
    need: 0,
  },
  Collect: {
    actual: 0,
    need: 0,
  },
  Store: {
    actual: 0,
    need: 0,
  },
  Cleaning: {
    actual: 0,
    need: 0,
  },
  Expansion: {
    actual: 0,
    need: 0,
  },
}

// setInterval(() => {
//   Object.keys(NestNeeds).forEach((need) => {
//     if (NestNeeds[need].actual < 1) NestNeeds[need].actual -= 1
//   })
// }, 1000)

const antBorn = (first, camera, scene) => {
  let type = ['W', 'W', 'P', 'W', 'W', 'P'][Math.floor(Math.random() * 6)]
  let ant = new Ant(type, camera, scene)

  ant.setNestCallback = (task) => {
    NestNeeds[task.type].actual += 1
    NestNeeds.Collect.need += 0.25
    switch (task.type) {
      case 'Protection':
        NestNeeds.Exploration.need += 1
        break
      case 'Exploration':
        NestNeeds.Protection.need += 1
        break
      case 'Collect':
        NestNeeds.Store.need += 1
        break
      case 'Store':
        NestNeeds.Expansion.need += 1
        break
      case 'Expansion':
        NestNeeds.Cleaning.need += 1
        NestNeeds.Exploration.need += 1
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
  }
  ant.setReproductionCallback = (id) => {
    if (ants.length < MAX_ANTS) antBorn(false, camera, scene)
  }
  ant.setNestNeeds = NestNeeds
  ant.live()
  if (!first) ant.registerCollider(ants)
  ants.push(ant)
}

const creatGUI = (test_AdvancedTexture) => {
  const Panel = createSimplePanel({})
  let textBox = new GUI.TextBlock('score')
  textBox.textWrapping = GUI.TextWrapping.WordWrap
  textBox.fontFamily = 'Roboto'
  textBox.fontSize = '10px'
  textBox.textHorizontalAlignment = 0
  textBox.textVerticalAlignment = 0

  Panel.addControl(textBox)
  test_AdvancedTexture.addControl(Panel)
  return textBox
}

export const Create = (engine, rootingCallback) => {
  const space_size = MAX_ANTS
  const scene = getNewScene(engine)
  // scene.enablePhysics(new BABYLON.Vector3(0, -10, 0), new BABYLON.CannonJSPlugin())
  const camera = getNewCamera('mainCamera01', scene, canvas, space_size)
  const light = getNewLight('mainLight01', scene)
  const test_AdvancedTexture = GUI.AdvancedDynamicTexture.CreateFullscreenUI('ui1', scene)

  let taskBox = BABYLON.Mesh.CreateBox(`nest-box`, 0.1, scene)
  taskBox.position = new BABYLON.Vector3.Zero()
  createLabel(test_AdvancedTexture, taskBox, 'Anthill')
  Object.keys(TASK_POSITIONS).forEach((task) => {
    let taskBox = BABYLON.Mesh.CreateBox(`${task}-box`, 0.1, scene)
    taskBox.position = TASK_POSITIONS[task]
    createLabel(test_AdvancedTexture, taskBox, task)
  })

  for (let i = 0; i < space_size / 10; i++) {
    antBorn(true, camera, scene)
  }

  ants.forEach((ant) => {
    ant.registerCollider(ants)
  })

  let textBox = creatGUI(test_AdvancedTexture)

  scene.registerBeforeRender(() => {})

  engine.runRenderLoop(() => {
    textBox.text = JSON.stringify({ totalAnts: ants.length, ...NestNeeds }, null, 2)
  })

  return scene
}
