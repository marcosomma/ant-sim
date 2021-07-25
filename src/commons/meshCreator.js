import * as BABYLON from 'babylonjs'
import { getAnimationSphere } from './helper'

export const createSphere = (args, diameter, segments, color, camera, scene) => {
  let sphere = BABYLON.Mesh.CreateSphere(args.id, segments, diameter, scene)

  sphere.name = args.name
  sphere.material = new BABYLON.StandardMaterial(`shere:${args.id}`, scene)
  sphere.material.diffuseColor = color
  sphere.checkCollisions = true
  sphere.actionManager = new BABYLON.ActionManager(scene)

  sphere.actionManager.registerAction(
    new BABYLON.ExecuteCodeAction(
      BABYLON.ActionManager.OnLeftPickTrigger,
      ((sphere, args) => {
        camera.position = new BABYLON.Vector3(
          sphere.position.x - 10,
          camera.position.y,
          sphere.position.z - 10
        )
        camera.setTarget(sphere.position)
      }).bind(this, sphere, args)
    )
  )
  return sphere
}
