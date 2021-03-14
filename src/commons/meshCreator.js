import * as BABYLON from 'babylonjs'
import { getAnimationSphere } from './helper'

export const createGround = (scene, ground_size, name) => {
  let segments = Math.floor(ground_size / 24)
  let xray_mat = new BABYLON.StandardMaterial(name + 'mat', scene)
  let fresnel_params = getFresnel()

  xray_mat.emissiveColor = new BABYLON.Color3(1, 1, 1)
  xray_mat.alpha = 0.001
  xray_mat.emissiveFresnelParameters = fresnel_params[0]
  xray_mat.opacityFresnelParameters = fresnel_params[1]
  xray_mat.wireframe = true
  xray_mat.backFaceCulling = false

  let edge_01 = createGroundEdge(name, xray_mat, ground_size, 1, scene)
  let edge_02 = createGroundEdge(name, xray_mat, ground_size, 2, scene)
  let edge_03 = createGroundEdge(name, xray_mat, ground_size, 3, scene)
  let edge_04 = createGroundEdge(name, xray_mat, ground_size, 4, scene)
  let edge_05 = createGroundEdge(name, xray_mat, ground_size, 5, scene)
  let edge_06 = createGroundEdge(name, xray_mat, ground_size, 6, scene)
  let edge_07 = createGroundEdge(name, xray_mat, ground_size, 7, scene)
  let edge_08 = createGroundEdge(name, xray_mat, ground_size, 8, scene)
  let edge_09 = createGroundEdge(name, xray_mat, ground_size, 9, scene)
  let edge_10 = createGroundEdge(name, xray_mat, ground_size, 10, scene)
  let edge_11 = createGroundEdge(name, xray_mat, ground_size, 11, scene)
  let edge_12 = createGroundEdge(name, xray_mat, ground_size, 12, scene)

  let ground_base = createGroundWalls(name, xray_mat, ground_size, segments, 1, scene)
  let ground_top = createGroundWalls(name, xray_mat, ground_size, segments, 2, scene)
  let ground_face_01 = createGroundWalls(name, xray_mat, ground_size, segments, 3, scene)
  let ground_face_02 = createGroundWalls(name, xray_mat, ground_size, segments, 4, scene)
  let ground_face_03 = createGroundWalls(name, xray_mat, ground_size, segments, 5, scene)
  let ground_face_04 = createGroundWalls(name, xray_mat, ground_size, segments, 6, scene)

  ground_face_01.rotation.x = ground_face_02.rotation.x = ground_face_03.rotation.x = ground_face_04.rotation.x = ground_face_03.rotation.z = ground_face_04.rotation.z = edge_03.rotation.y = edge_04.rotation.y = edge_07.rotation.y = edge_08.rotation.y = edge_09.rotation.z = edge_10.rotation.z = edge_11.rotation.z = edge_12.rotation.z =
    -Math.PI / 2

  return {
    ground_base,
    ground_top,
    ground_face_01,
    ground_face_02,
    ground_face_03,
    ground_face_04,
    edge_01,
    edge_02,
    edge_03,
    edge_04,
    edge_05,
    edge_06,
    edge_07,
    edge_08,
    edge_09,
    edge_10,
    edge_11,
    edge_12,
  }
}

export const createSphere = (args, diameter, segments, color, camera, scene) => {
  let sphere = BABYLON.Mesh.CreateSphere(args.id, segments, diameter, scene)
  let fresnel_params = getFresnel()

  sphere.name = args.name
  sphere.material = new BABYLON.StandardMaterial(`shere:${args.id}`, scene)
  sphere.material.color = color
  sphere.material.emissiveFresnelParameters = fresnel_params[0]
  sphere.material.opacityFresnelParameters = fresnel_params[1]
  sphere.checkCollisions = true
  sphere.animations.push(getAnimationSphere())
  sphere.actionManager = new BABYLON.ActionManager(scene)

  sphere.physicsImpostor = new BABYLON.PhysicsImpostor(
    sphere,
    BABYLON.PhysicsImpostor.SphereImpostor,
    {
      mass: 1,
    },
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
  return sphere
}

const getFresnel = () => {
  var fresnel_params = new BABYLON.FresnelParameters()
  fresnel_params.isEnabled = true
  fresnel_params.leftColor = new BABYLON.Color3(0.25, 0.3, 0.5)
  fresnel_params.rightColor = new BABYLON.Color3(0, 0, 0)
  fresnel_params.power = 1
  fresnel_params.bias = 0.1
  var fresnel_params2 = new BABYLON.FresnelParameters()
  fresnel_params2.isEnabled = true
  fresnel_params2.leftColor = new BABYLON.Color3(0.5, 0.5, 0.5)
  fresnel_params2.rightColor = new BABYLON.Color3(0.1, 0.1, 0.1)
  fresnel_params2.power = 2
  fresnel_params2.bias = 0.5

  return [fresnel_params, fresnel_params2]
}

const createGroundEdge = (name, material, size, index, scene) => {
  let positions = [
    new BABYLON.Vector3(0, -(size / 4), size / 2), //edge_01
    new BABYLON.Vector3(0, -(size / 4), -(size / 2)), //edge_02
    new BABYLON.Vector3(size / 2, -(size / 4), 0), //edge_03
    new BABYLON.Vector3(-(size / 2), -(size / 4)), //edge_04
    new BABYLON.Vector3(0, (size / 4) * 3, size / 2), //edge_05
    new BABYLON.Vector3(0, (size / 4) * 3, -(size / 2)), //edge_06
    new BABYLON.Vector3(size / 2, (size / 4) * 3, 0), //edge_07
    new BABYLON.Vector3(-(size / 2), (size / 4) * 3, 0), //edge_08
    new BABYLON.Vector3(-(size / 2), size / 4, -(size / 2)), //edge_09
    new BABYLON.Vector3(size / 2, size / 4, size / 2), //edge_10
    new BABYLON.Vector3(-(size / 2), size / 4, size / 2), //edge_11
    new BABYLON.Vector3(size / 2, size / 4, -(size / 2)), //edge_12
  ]
  let edge = BABYLON.Mesh.CreateBox(name + 'edge' + index, size, scene)
  edge.material = material
  edge.scaling = new BABYLON.Vector3(1, 0.25 / size, 0.25 / size)
  edge.position = positions[index - 1]
  edge.isPickable = false
  return edge
}

const createGroundWalls = (name, material, size, segments, index, scene) => {
  let positions = [
    new BABYLON.Vector3(0, -(size / 4), 0), //ground_base
    new BABYLON.Vector3(0, (size / 4) * 3, 0), //ground_top
    new BABYLON.Vector3(0, size / 4, size / 2), //ground_face_01
    new BABYLON.Vector3(0, size / 4, -(size / 2)), //ground_face_02
    new BABYLON.Vector3(-(size / 2), size / 4, 0), //ground_face_03
    new BABYLON.Vector3(size / 2, size / 4, 0), //ground_face_04
  ]

  let ground = BABYLON.Mesh.CreateGround(
    name + 'ground' + index,
    size,
    size,
    segments,
    scene,
    true,
    BABYLON.Mesh.DOUBLESIDE
  )
  ground.material = material
  ground.position = positions[index - 1]
  ground.isPickable = false

  return ground
}
