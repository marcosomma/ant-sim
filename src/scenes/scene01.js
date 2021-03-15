import * as BABYLON from 'babylonjs'
import * as GUI from 'babylonjs-gui'
import { createSphere } from '../commons/meshCreator'
import {
  getNewScene,
  getNewCamera,
  getNewLight,
  createLabel,
  createSimpleBtn,
  createSimplePanel,
} from '../commons/helper'

const canvas = document.getElementById('renderCanvas')

export const registerEventListener = () => {
  console.log('registring events')
}

export const Create = (engine, rootingCallback) => {
  const space_size = 200
  const scene = getNewScene(engine)
  scene.enablePhysics(new BABYLON.Vector3(0, -10, 0), new BABYLON.CannonJSPlugin())
  const camera = getNewCamera('mainCamera01', scene, canvas, space_size)
  const light = getNewLight('mainLight01', scene)
  const ground = BABYLON.MeshBuilder.CreateGround('ground', { width: space_size * 10, height: space_size * 10 }, scene)
  ground.physicsImpostor = new BABYLON.PhysicsImpostor(
    ground,
    BABYLON.PhysicsImpostor.BoxImpostor,
    { mass: 0, friction: 0.5, restitution: 1 },
    scene
  )
  const sphere = createSphere(
    { id: 'test-sphere', name: 'sphere - test' },
    2.5,
    12,
    new BABYLON.Color3(Math.random() * 1, Math.random() * 1, Math.random() * 1),
    camera,
    scene
  )
  scene.beginWeightedAnimation(sphere, 0, 100, 0.25, true)

  scene.registerBeforeRender(function () {})

  return scene
}
