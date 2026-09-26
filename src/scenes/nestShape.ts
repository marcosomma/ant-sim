import { Quaternion, Vector3 } from '@babylonjs/core'

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
