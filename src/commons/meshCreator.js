import * as BABYLON from 'babylonjs'
import { getAnimationSphere } from './helper'

export const createSphere = (args, diameter, segments, color, camera, scene) => {
  let sphere = BABYLON.Mesh.CreateSphere(args.id, segments, diameter, scene)

  sphere.name = args.name
  sphere.material = new BABYLON.StandardMaterial(`shere:${args.id}`, scene)
  sphere.material.diffuseColor = color
  sphere.checkCollisions = true
  sphere.animations.push(getAnimationSphere())
  sphere.actionManager = new BABYLON.ActionManager(scene)

  sphere.physicsImpostor = new BABYLON.PhysicsImpostor(
    sphere,
    BABYLON.PhysicsImpostor.SphereImpostor,
    { mass: 1, friction: 0.5, restitution: 0.1 },
    scene
  )

  sphere.actionManager.registerAction(
    new BABYLON.ExecuteCodeAction(
      BABYLON.ActionManager.OnLeftPickTrigger,
      ((sphere, args) => {
        camera.position = new BABYLON.Vector3(sphere.position.x, sphere.position.y, camera.position.z)
        camera.setTarget(sphere.position)
      }).bind(this, sphere, args)
    )
  )

  sphere.position = new BABYLON.Vector3(0, 20, 0)
  return sphere
}
