import * as BABYLON from 'babylonjs'
import * as GUI from 'babylonjs-gui'
import { getNewScene, getNewCamera, getNewLight, createLabel } from '../commons/helper'
import Ant, { TASK_POSITIONS } from '../classes/ant'

const canvas = document.getElementById('renderCanvas')

export const registerEventListener = () => {
  console.log('registring events')
}

let NestNeeds = {
  perimetral: {
    actual: 0,
    need: 3,
  },
  explore: {
    actual: 0,
    need: 150,
  },
  collect: {
    actual: 0,
    need: 300,
  },
  store: {
    actual: 0,
    need: 50,
  },
  cleaning: {
    actual: 0,
    need: 100,
  },
}

setInterval(() => {
  Object.keys(NestNeeds).forEach((need) => {
    if (NestNeeds[need].actual > 0) NestNeeds[need].actual -= 1
  })
}, 100)

export const Create = (engine, rootingCallback) => {
  const space_size = 200
  const scene = getNewScene(engine)
  // scene.enablePhysics(new BABYLON.Vector3(0, -10, 0), new BABYLON.CannonJSPlugin())
  const camera = getNewCamera('mainCamera01', scene, canvas, space_size)
  const light = getNewLight('mainLight01', scene)
  const test_AdvancedTexture = GUI.AdvancedDynamicTexture.CreateFullscreenUI('ui1', scene)

  Object.keys(TASK_POSITIONS).forEach((task) => {
    let taskBox = BABYLON.Mesh.CreateBox(`${task}-box`, 3, scene)
    taskBox.position = TASK_POSITIONS[task]
    createLabel(test_AdvancedTexture, taskBox, task)
  })
  let ants = []
  for (let i = 0; i < space_size; i++) {
    let type = ['W', 'W', 'W', 'P'][Math.floor(Math.random() * 4)]
    let ant = new Ant(type, camera, scene)

    ant.setNestCallback = (task) => {
      if (NestNeeds[task.type].actual > NestNeeds[task.type].need) NestNeeds[task.type].actual += 1
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
  scene.registerBeforeRender(() => {})

  engine.runRenderLoop(() => {})

  return scene
}
