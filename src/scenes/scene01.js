import * as BABYLON from 'babylonjs'
import * as GUI from 'babylonjs-gui'
import { getNewScene, getNewCamera, getNewLight, createLabel } from '../commons/helper'
import Ant, { TASK_POSITIONS } from '../classes/ant'

const canvas = document.getElementById('renderCanvas')

export const registerEventListener = () => {
  console.log('registring events')
}

let NestNeeds = {
  Protection: {
    actual: 0,
    need: 30,
  },
  Exploration: {
    actual: 0,
    need: 150,
  },
  Collect: {
    actual: 0,
    need: 300,
  },
  Store: {
    actual: 0,
    need: 50,
  },
  Cleaning: {
    actual: 0,
    need: 100,
  },
  Expansion: {
    actual: 0,
    need: 200,
  },
}

setInterval(() => {
  Object.keys(NestNeeds).forEach((need) => {
    if (NestNeeds[need].actual > 0) NestNeeds[need].actual -= 1
  })
}, 100)

export const Create = (engine, rootingCallback) => {
  const space_size = 250
  const scene = getNewScene(engine)
  // scene.enablePhysics(new BABYLON.Vector3(0, -10, 0), new BABYLON.CannonJSPlugin())
  const camera = getNewCamera('mainCamera01', scene, canvas, space_size)
  const light = getNewLight('mainLight01', scene)
  const test_AdvancedTexture = GUI.AdvancedDynamicTexture.CreateFullscreenUI('ui1', scene)

  Object.keys(TASK_POSITIONS).forEach((task) => {
    let taskBox = BABYLON.Mesh.CreateBox(`${task}-box`, .1, scene)
    taskBox.position = TASK_POSITIONS[task]
    createLabel(test_AdvancedTexture, taskBox, task)
  })
  let ants = []
  for (let i = 0; i < space_size; i++) {
    let type = ['W', 'W', 'W', 'P'][Math.floor(Math.random() * 4)]
    let ant = new Ant(type, camera, scene)

    ant.setNestCallback = (task) => {
      if (NestNeeds[task.type].actual > NestNeeds[task.type].need) {
        NestNeeds[task.type].actual += 1
      }
      NestNeeds.Collect.need += 1
      switch (task.type) {
        case 'Protection':

          break;
        case 'Exploration':
          NestNeeds.Store.need += .1
          break;
        case 'Collect':
          NestNeeds.Store.need += 1
          break;
        case 'Store':

          break;
        case 'Expansion':
          NestNeeds.Cleaning.need += 1
          break;
        case 'Cleaning':

          break;

        default:
          break;
      }
      ant.setNestNeeds = NestNeeds
    }
    ant.setNestNeeds = NestNeeds
    ant.live()
    ants.push(ant)
  }

  ants.forEach((ant) => {
    ant.registerCollider(ants)
  })
  console.log('Ants:', ants)
  scene.registerBeforeRender(() => { })

  engine.runRenderLoop(() => { })

  return scene
}
