import { Color3, Matrix, Mesh, MeshBuilder, Quaternion, Scene, StandardMaterial, Vector3 } from '@babylonjs/core'

import type Ant from '../classes/ant'
import { simNow } from '../commons/simClock'
import { POPULATION_CAP } from '../constants'
import { leafMesh } from './nestShape'

// Ant bodies: head, thorax, gaster, six legs and two antennae per ant, drawn as thin
// instances of five meshes (so 500 ants are five draw calls), placed and animated every
// frame from the model's position of each ant. The model's own sphere stays as the anchor
// and the collider; it is simply not drawn.
//
// Gait: the alternating tripod real ants use (front-left, mid-right, hind-left on the ground
// while the other three swing, then the reverse). Its phase advances with the DISTANCE the
// ant has walked, so it follows the simulation clock exactly: paused it freezes, at 16× it
// runs at 16×; a quick ant's legs move faster. Antennae and the gaster's bob run on sim time
// too. Asleep: legs tucked, still, darker. Visual only: reads the ants, never writes them.

/** How the view wants an ant shown: its tint, and whether it is singled out, dimmed or hidden. */
export interface AntLook {
  tint: Color3
  /** 0..1 brightness (how much of the map the ant knows). */
  bright: number
  mode: 'full' | 'dim' | 'hidden'
}

/** Overall size: a worker's body is about ANT_SCALE × 2 long (its collider sphere is 1 across). */
const ANT_SCALE = 0.55
/** One stride, in body units. */
const STRIDE = 0.9
const LEG_RADIUS = 0.035
const ANTENNA_RADIUS = 0.025
const LIFT = 0.42 // the body rides this high over the ground on its legs

/** Hip and foot positions in body space (x right, y up, z forward), for the three legs of one side. */
const LEGS: { hip: [number, number, number]; foot: [number, number, number]; phase: number }[] = [
  { hip: [0.18, 0.4, 0.22], foot: [0.55, 0, 0.5], phase: 0 }, // front
  { hip: [0.2, 0.38, 0], foot: [0.62, 0, -0.02], phase: Math.PI }, // middle
  { hip: [0.18, 0.4, -0.22], foot: [0.55, 0, -0.55], phase: 0 }, // hind
]

interface State {
  prev: Vector3
  /** Body orientation: +z along the direction of travel, +y away from what it walks on. */
  rot: Quaternion
  phase: number
  look: AntLook
}

const FORWARD = new Vector3(0, 0, 1)
const DEFAULT_LOOK: AntLook = { tint: new Color3(0.8, 0.8, 0.8), bright: 0.5, mode: 'full' }

/** A unit-height cylinder standing on its origin, so a scale in y sets its length. */
const strut = (scene: Scene, name: string, radius: number): Mesh => {
  const m = MeshBuilder.CreateCylinder(name, { height: 1, diameter: radius * 2, tessellation: 5 }, scene)
  m.bakeTransformIntoVertices(Matrix.Translation(0, 0.5, 0))
  return m
}

export class AntBodies {
  private parts: Record<'thorax' | 'head' | 'gaster' | 'leg' | 'antenna' | 'leaf' | 'pebble', Mesh>
  private buffers = new Map<Mesh, { matrix: Float32Array; color: Float32Array; capacity: number; used: number }>()
  private states = new WeakMap<Ant, State>()
  private hidden = new WeakSet<Mesh>()

  // Scratch objects, reused every frame (no allocation in the per-ant loop).
  private q = new Quaternion()
  private qPart = new Quaternion()
  private qWant = new Quaternion()
  private v = new Vector3()
  private v2 = new Vector3()
  private fwd = new Vector3()
  private up = new Vector3()
  private scale = new Vector3()
  private m = new Matrix()

  constructor(private scene: Scene) {
    const body = (name: string, dx: number, dy: number, dz: number): Mesh =>
      MeshBuilder.CreateSphere(`ant:${name}`, { diameterX: dx, diameterY: dy, diameterZ: dz, segments: 8 }, scene)
    this.parts = {
      thorax: body('thorax', 0.5, 0.42, 0.78),
      head: body('head', 0.5, 0.44, 0.56),
      gaster: body('gaster', 0.66, 0.58, 0.98),
      leg: strut(scene, 'ant:leg', LEG_RADIUS),
      antenna: strut(scene, 'ant:antenna', ANTENNA_RADIUS),
      leaf: leafMesh(scene, 'ant:leaf', 1.1),
      pebble: MeshBuilder.CreateIcoSphere('ant:pebble', { radius: 0.24, subdivisions: 1, flat: true }, scene),
    }
    const per: Record<keyof AntBodies['parts'], number> = { thorax: 1, head: 1, gaster: 1, leg: 6, antenna: 2, leaf: 1, pebble: 1 }
    const dark = new Color3(0.14, 0.14, 0.14)
    ;(Object.keys(this.parts) as (keyof AntBodies['parts'])[]).forEach((key) => {
      const mesh = this.parts[key]
      const mat = new StandardMaterial(`ant:${key}`, scene)
      mat.diffuseColor = Color3.White()
      mat.specularColor = new Color3(0.15, 0.15, 0.15)
      // A floor of light, so ants stay visible in the dark underground view.
      mat.emissiveColor = dark
      if (key === 'leaf') mat.backFaceCulling = false
      mesh.material = mat
      mesh.isPickable = false
      mesh.alwaysSelectAsActiveMesh = true // instances spread over the world: never frustum-culled as one
      const capacity = POPULATION_CAP * per[key]
      const matrix = new Float32Array(capacity * 16)
      const color = new Float32Array(capacity * 4)
      mesh.thinInstanceSetBuffer('matrix', matrix, 16, false)
      mesh.thinInstanceSetBuffer('color', color, 4, false)
      mesh.thinInstanceCount = 0
      this.buffers.set(mesh, { matrix, color, capacity, used: 0 })
    })
    // The leaf a forager carries is a greener piece; the pebble is soil.
    ;(this.parts.pebble.material as StandardMaterial).diffuseColor = new Color3(0.4, 0.32, 0.24)
  }

  /** How the view wants this ant shown (set by the colony view's refresh, a few times a second). */
  setLook(ant: Ant, look: AntLook): void {
    const s = this.state(ant)
    s.look.tint.copyFrom(look.tint)
    s.look.bright = look.bright
    s.look.mode = look.mode
  }

  private state(ant: Ant): State {
    let s = this.states.get(ant)
    if (!s) {
      const p = ant.data.body.position as Vector3
      s = {
        prev: p.clone(),
        rot: Quaternion.RotationYawPitchRoll(Math.random() * Math.PI * 2, 0, 0),
        phase: Math.random() * Math.PI * 2,
        look: { ...DEFAULT_LOOK, tint: DEFAULT_LOOK.tint.clone() },
      }
      this.states.set(ant, s)
    }
    return s
  }

  /** Called every frame. */
  update(ants: Ant[]): void {
    this.buffers.forEach((b) => (b.used = 0))
    const t = simNow() / 1000
    ants.forEach((ant) => {
      const body = ant.data.body as Mesh | null
      if (!body) return
      if (!this.hidden.has(body)) {
        body.isVisible = false // the model's sphere is the anchor and collider, not the drawing
        this.hidden.add(body)
      }
      this.draw(ant, body.position, t)
    })
    this.buffers.forEach((b, mesh) => {
      mesh.thinInstanceCount = b.used
      if (b.used > 0) {
        mesh.thinInstanceBufferUpdated('matrix')
        mesh.thinInstanceBufferUpdated('color')
      }
    })
  }

  private draw(ant: Ant, pos: Vector3, t: number): void {
    const s = this.state(ant)
    const look = s.look
    if (look.mode === 'hidden') {
      s.prev.copyFrom(pos)
      return
    }
    const size = ANT_SCALE * (ant.data.size === 'big' ? 1.5 : 1) * (look.mode === 'dim' ? 0.55 : 1)

    // Heading and gait from how far the ant moved since last frame (sim-clock driven).
    const dx = pos.x - s.prev.x
    const dz = pos.z - s.prev.z
    const dy = pos.y - s.prev.y
    const moved = Math.sqrt(dx * dx + dz * dz + dy * dy)
    const asleep = ant.isSleeping
    if (moved > 1e-4 && !asleep) {
      // Face the way it moves, in 3D: along a gallery, up or down the shaft. "Up" is kept from
      // the current pose (projected off the new heading) so climbing doesn't spin the body;
      // near-vertical travel falls back to a fixed side. Snap on a big jump (a teleport home
      // or to bed), turn smoothly otherwise.
      this.fwd.set(dx, dy, dz).scaleInPlace(1 / moved)
      // Belly down: "up" is world up projected off the heading, so the ant walks on the floor
      // of a gallery or the ground. Only on a (near) vertical climb, where world up is useless,
      // keep the side it already had, so it doesn't spin on the shaft.
      this.up.copyFrom(Vector3.UpReadOnly)
      this.up.subtractInPlace(this.fwd.scale(Vector3.Dot(this.up, this.fwd)))
      if (this.up.lengthSquared() < 0.08) {
        Vector3.UpReadOnly.rotateByQuaternionToRef(s.rot, this.up)
        this.up.subtractInPlace(this.fwd.scale(Vector3.Dot(this.up, this.fwd)))
        if (this.up.lengthSquared() < 0.05) this.up.copyFrom(Math.abs(this.fwd.x) < 0.9 ? Vector3.RightReadOnly : FORWARD)
      }
      this.up.normalize()
      // (Babylon's look-rotation points the body's +z the other way: hand it the reverse.)
      this.v2.copyFrom(this.fwd).scaleInPlace(-1)
      Quaternion.FromLookDirectionLHToRef(this.v2, this.up, this.qWant)
      if (moved > 3) s.rot.copyFrom(this.qWant)
      else Quaternion.SlerpToRef(s.rot, this.qWant, 0.35, s.rot)
      s.phase += moved / (STRIDE * size)
    } else if (asleep) {
      // Settle level in bed: keep the heading, drop pitch and roll.
      FORWARD.rotateByQuaternionToRef(s.rot, this.fwd)
      if (this.fwd.x * this.fwd.x + this.fwd.z * this.fwd.z > 1e-6) {
        Quaternion.RotationYawPitchRollToRef(Math.atan2(this.fwd.x, this.fwd.z), 0, 0, this.qWant)
        Quaternion.SlerpToRef(s.rot, this.qWant, 0.1, s.rot)
      }
    }
    s.prev.copyFrom(pos)
    const walking = !asleep

    // Colour: task tint, brighter with knowledge; darker asleep; grey when dimmed.
    let r = look.tint.r
    let g = look.tint.g
    let b = look.tint.b
    const k = (0.55 + 0.45 * look.bright) * (asleep ? 0.6 : 1)
    r *= k
    g *= k
    b *= k
    if (look.mode === 'dim') {
      const grey = 0.22
      r = g = b = grey
    }

    this.q.copyFrom(s.rot)
    const lift = LIFT * size + (walking ? 0.02 * size * Math.sin(s.phase * 2) : -0.08 * size)
    const place = (mesh: Mesh, lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, rot: Quaternion): void => {
      const buf = this.buffers.get(mesh)!
      if (buf.used >= buf.capacity) return
      this.v.set(lx * size, ly * size + lift, lz * size)
      this.v.rotateByQuaternionToRef(this.q, this.v)
      this.v.addInPlace(pos)
      this.scale.set(sx * size, sy * size, sz * size)
      Matrix.ComposeToRef(this.scale, rot, this.v, this.m)
      this.m.copyToArray(buf.matrix, buf.used * 16)
      buf.color[buf.used * 4] = r
      buf.color[buf.used * 4 + 1] = g
      buf.color[buf.used * 4 + 2] = b
      buf.color[buf.used * 4 + 3] = 1
      buf.used++
    }
    // A strut from body-space point a to b: length along its own y.
    const strutTo = (mesh: Mesh, ax: number, ay: number, az: number, bx: number, by: number, bz: number): void => {
      const buf = this.buffers.get(mesh)!
      if (buf.used >= buf.capacity) return
      this.v2.set(bx - ax, by - ay, bz - az)
      const len = this.v2.length()
      if (len < 1e-4) return
      this.v2.scaleInPlace(1 / len)
      Quaternion.FromUnitVectorsToRef(Vector3.UpReadOnly, this.v2, this.qPart)
      this.q.multiplyToRef(this.qPart, this.qPart)
      place(mesh, ax, ay, az, 1, len, 1, this.qPart)
    }

    // Body segments.
    const gasterBob = walking ? 0.03 * Math.sin(s.phase * 2 + 1) : 0
    place(this.parts.thorax, 0, 0.42, 0, 1, 1, 1, this.q)
    place(this.parts.head, 0, 0.46, 0.58, 1, 1, 1, this.q)
    place(this.parts.gaster, 0, 0.4 + gasterBob, -0.7, 1, 1, 1, this.q)

    // Legs: alternating tripod. Foot swings back on the ground (stance) and forward lifted (swing).
    for (const side of [1, -1]) {
      LEGS.forEach((leg, i) => {
        const [hx, hy, hz] = leg.hip
        const [fx, fy, fz] = leg.foot
        let footX = fx * side
        let footY = fy
        let footZ = fz
        if (asleep) {
          // Tucked in under the body.
          footX = (fx * 0.45) * side
          footY = 0.1
          footZ = fz * 0.6
        } else {
          // Opposite sides are half a cycle apart; front and hind on one side share a phase.
          const ph = s.phase + leg.phase + (side < 0 ? Math.PI : 0) + i * 0.15
          const swing = -Math.cos(ph) // > 0 while the foot moves forward (lifted)
          footZ = fz - 0.2 * Math.sin(ph)
          footY = Math.max(0, swing) * 0.16
        }
        strutTo(this.parts.leg, hx * side, hy, hz, footX, footY, footZ)
      })
    }

    // Antennae: from the head, forward and out, feeling about on sim time.
    for (const side of [1, -1]) {
      const wag = asleep ? 0 : 0.12 * Math.sin(t * 7 + side * 1.3 + s.phase)
      strutTo(this.parts.antenna, 0.09 * side, 0.55, 0.78, (0.34 + wag) * side, 0.78 + (asleep ? -0.15 : 0.05 * Math.cos(t * 5 + side)), 1.15)
    }

    // What it carries, held at the mandibles.
    if (ant.carried > 0) {
      const sav = [r, g, b]
      r = 0.62
      g = 0.78
      b = 0.3
      place(this.parts.leaf, 0, 0.5, 1.05, 1, 1, 1, this.q)
      ;[r, g, b] = sav
    } else if (ant.carryingDebris) {
      const sav = [r, g, b]
      r = g = b = 1
      place(this.parts.pebble, 0, 0.5, 1.0, 1, 1, 1, this.q)
      ;[r, g, b] = sav
    }
  }
}
