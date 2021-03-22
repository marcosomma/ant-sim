import * as BABYLON from 'babylonjs'
import { getAnimationSphere } from './helper'

export const createSphere = (args, diameter, segments, color, camera, scene) => {
  let sphere = BABYLON.Mesh.CreateSphere(args.id, segments, diameter, scene)

  sphere.name = args.name
  sphere.material = new BABYLON.StandardMaterial(`shere:${args.id}`, scene)
  sphere.material.diffuseColor = color
  sphere.checkCollisions = true
  // sphere.animations.push(getAnimationSphere())
  sphere.actionManager = new BABYLON.ActionManager(scene)

  // sphere.physicsImpostor = new BABYLON.PhysicsImpostor(
  //   sphere,
  //   BABYLON.PhysicsImpostor.SphereImpostor,
  //   { mass: 0.1, friction: 1, restitution: 0 },
  //   scene
  // )

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

  // sphere.onCollideObservable.add((ev, args) => {
  //   console.log('onCollideObservable')
  //   console.log(ev)
  //   console.log(args)
  // })

  // sphere.actionManager.registerAction(
  //   new BABYLON.ExecuteCodeAction(
  //     BABYLON.ActionManager.OnIntersectionEnterTrigger,
  //     (() => {
  //       console.log('collision')
  //       console.log(this)
  //     }).bind(this, sphere)
  //   )
  // )

  // sphere.position = new BABYLON.Vector3(0, 20, 0)
  return sphere
}
