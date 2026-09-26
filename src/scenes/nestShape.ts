import { Mesh, MeshBuilder, Quaternion, Scene, Vector3, VertexBuffer } from '@babylonjs/core'

import { NEST_BASE_DIAMETER, SEARCHING_RADIUS, SLEEP_CHAMBER_RADIUS, SYMBOL_SCALE } from '../constants'

// The shape of the nest, shared by what draws it (NestView, ColonyView): the anthill mound and
// the room shells below. Visual only: the ants' own routes are the model's (constants.digPathTo).

const S = SYMBOL_SCALE
const R = SEARCHING_RADIUS

/** Room shells: queen's chamber, dug rooms and the sleep chamber (radius, height share). */
export const QUEEN_ROOM_RADIUS = 0.32 * R
export const QUEEN_SQUASH = 0.8
export const ROOM_SQUASH = 0.6
export const SLEEP_ROOM_RADIUS = SLEEP_CHAMBER_RADIUS + 2 * S
export const SLEEP_SQUASH = 0.8

/** The anthill mound's profile (radius, height) in units of its base radius, rim to entrance. */
export const NEST_PROFILE: [number, number][] = [
  [1.0, -0.05],
  [0.98, 0.02],
  [0.82, 0.12],
  [0.6, 0.26],
  [0.4, 0.38],
  [0.26, 0.44],
  [0.19, 0.44],
  [0.15, 0.38],
  [0.11, 0.32],
  [0, 0.32],
]
/** Radius of the entrance hole on top of the mound, in base radii. */
export const NEST_ENTRANCE = 0.13
export const NEST_BASE_RADIUS = NEST_BASE_DIAMETER / 2

/**
 * Tilt that lays something flat ON the ground at (x, z): the rotation taking "up" to the
 * terrain's normal there, measured over `span` (the size of the thing), so a spot on a slope
 * lies along the slope instead of half sinking into it.
 */
export const groundTilt = (heightAt: (x: number, z: number) => number, x: number, z: number, span: number): Quaternion => {
  const dx = (heightAt(x + span, z) - heightAt(x - span, z)) / (2 * span)
  const dz = (heightAt(x, z + span) - heightAt(x, z - span)) / (2 * span)
  const normal = new Vector3(-dx, 1, -dz).normalize()
  const axis = Vector3.Cross(Vector3.Up(), normal)
  const angle = Math.acos(Math.min(1, Vector3.Dot(Vector3.Up(), normal)))
  return axis.lengthSquared() < 1e-8 ? Quaternion.Identity() : Quaternion.RotationAxis(axis.normalize(), angle)
}

/** Height of the mound above the ground at distance `r` from its centre, for a mound `scale` times its base size. */
export const moundHeightAt = (r: number, scale: number): number => {
  const rb = NEST_BASE_RADIUS * scale
  const u = r / rb
  for (let i = 1; i < NEST_PROFILE.length; i++) {
    const [ra, ya] = NEST_PROFILE[i - 1]
    const [rbb, yb] = NEST_PROFILE[i]
    if (u <= ra && u >= rbb) return (ya + ((yb - ya) * (ra - u)) / (ra - rbb || 1)) * rb
  }
  return u > 1 ? 0 : NEST_PROFILE[NEST_PROFILE.length - 1][1] * rb
}

/**
 * A leaf lying flat: a pointed lens `length` long, gently curled, with both faces drawn.
 * Food spots are a few fallen leaves; foragers carry a piece of one home; stores hold the pieces.
 */
export const leafMesh = (scene: Scene, name: string, length: number): Mesh => {
  const leaf = MeshBuilder.CreateDisc(name, { radius: length / 2, tessellation: 18, sideOrientation: Mesh.DOUBLESIDE }, scene)
  const p = leaf.getVerticesData(VertexBuffer.PositionKind)!
  for (let i = 0; i < p.length; i += 3) {
    const u = p[i] / (length / 2) // −1 … 1 along the leaf
    const taper = Math.sqrt(Math.max(0, 1 - u * u))
    p[i + 1] *= 0.45 * taper // narrow, pointed at both ends
    p[i + 2] = -0.12 * length * (1 - u * u) * 0.5 // a slight curl
  }
  leaf.updateVerticesData(VertexBuffer.PositionKind, p)
  leaf.rotation.x = Math.PI / 2 // lie flat
  leaf.bakeCurrentTransformIntoVertices()
  leaf.isPickable = false
  return leaf
}

/** Per-instance leaf shades, fresh green to yellow (deterministic per `seed`). */
export const leafTint = (count: number, seed = 0): Float32Array => {
  const tints = new Float32Array(count * 4)
  for (let i = 0; i < count; i++) {
    const t = (i * 0.618034 + seed * 0.21) % 1
    tints.set([0.55 + 0.4 * t, 0.8 - 0.1 * t, 0.25 + 0.05 * t, 1], i * 4)
  }
  return tints
}
