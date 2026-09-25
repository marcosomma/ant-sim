import {
  AbstractMesh,
  ActionManager,
  ArcRotateCamera,
  Color3,
  ExecuteCodeAction,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  Vector3,
} from '@babylonjs/core'

export interface CreateSphereArgs {
  id: string
  name: string
}

export const createSphere = (
  args: CreateSphereArgs,
  diameter: number,
  segments: number,
  color: Color3,
  camera: ArcRotateCamera,
  scene: Scene,
): Mesh => {
  const sphere = MeshBuilder.CreateSphere(args.id, { diameter, segments }, scene)

  sphere.name = args.name
  const material = new StandardMaterial(`sphere:${args.id}`, scene)
  material.diffuseColor = color
  sphere.material = material
  sphere.checkCollisions = true
  sphere.actionManager = new ActionManager(scene)

  sphere.actionManager.registerAction(
    new ExecuteCodeAction(ActionManager.OnLeftPickTrigger, () => {
      camera.position = new Vector3(sphere.position.x - 10, camera.position.y, sphere.position.z - 10)
      camera.setTarget(sphere as AbstractMesh)
    }),
  )

  // No physics impostor: encounters are detected with intersectsMesh (Ant.registerCollider).
  // A rigid body here only added contact velocities that flung non-animated ants
  // (newborns, paused sim) away from the nest forever — zero gravity, no damping.
  return sphere
}
