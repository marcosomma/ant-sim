import { Color3, Matrix, Mesh, MeshBuilder, Quaternion, Scene, StandardMaterial, Vector3 } from '@babylonjs/core'

import { FOUNDING, SEARCHING_RADIUS, SYMBOL_SCALE, TASK_POSITIONS, groundAt } from '../constants'
import type { Colony } from '../model/colony'
import { Focus, TASK_COLOR3 } from '../ui/palette'
import { QUEEN_ROOM_RADIUS, QUEEN_SQUASH, ROOM_SQUASH, groundTilt } from './nestShape'

// The underground anthill as real rooms, each showing what is in it:
//   the queen's (founding) chamber — the queen, and the little brood and food it holds;
//   dug rooms with a role — seed piles (store), eggs and larvae (nursery), or sleeping ants;
// plus the tunnel network the diggers leave behind.
//
// Everything underground is drawn clearly (no see-through ground over it, which made rooms,
// tunnels and the ground melt into one haze): each room is a closed shell, its upper half solid
// in the room's colour (by role) and its lower half 40% see-through, so what is in it shows;
// tunnels are thin cords along the smoothly curving tunnels, ants move along them like beads.
// It is all
// shown only in the underground view; the surface view shows nothing of it (see
// setUnderground). Visual only: reads the colony, never writes it.

const R = SEARCHING_RADIUS
const S = SYMBOL_SCALE
const ROOM_RADIUS = QUEEN_ROOM_RADIUS
const MAX_SEEDS = 80
const MAX_BROOD = 90

const EARTH = new Color3(0.55, 0.42, 0.3)
/** Sleeping rooms share the sleep chamber's blue. */
export const SLEEP_TINT = new Color3(0.45, 0.5, 0.75)

/** 'digging': the room at the digging front, still being dug (in the Expansion colour). */
type RoomLook = 'free' | 'store' | 'brood' | 'sleep' | 'queen' | 'digging'
const ROOM_TINT: Record<RoomLook, Color3> = {
  free: EARTH,
  store: TASK_COLOR3.Store,
  brood: TASK_COLOR3.EggLarvePupeaCare,
  sleep: SLEEP_TINT,
  queen: TASK_COLOR3.QueenCare,
  digging: TASK_COLOR3.Expansion,
}

const plain = (scene: Scene, name: string, color: Color3, emissive = 0.3): StandardMaterial => {
  const m = new StandardMaterial(name, scene)
  m.diffuseColor = color.clone()
  m.emissiveColor = color.scale(emissive)
  m.specularColor = Color3.Black()
  return m
}

/** Solid earth, tinted `k` of the way towards `tint`; both sides drawn and lit (seen from inside too). */
export const bowlMaterial = (scene: Scene, name: string, tint: Color3, k: number): StandardMaterial => {
  const m = plain(scene, name, Color3.Lerp(EARTH, tint, k), 0.3)
  m.backFaceCulling = false
  m.twoSidedLighting = true
  return m
}

/** Tunnels in the overview: thin cords along the (smoothly curving) tunnel, ants move along them like beads. */
export const TUNNEL_CORD = 0.3 * S
export const cordTube = (scene: Scene, name: string, path: Vector3[]): Mesh => {
  const tube = MeshBuilder.CreateTube(name, { path, radius: TUNNEL_CORD, tessellation: 6 }, scene)
  tube.isPickable = false
  return tube
}

/** An open bowl (the lower half of a sphere): `radius` wide, `squash` of that deep, rim at `at`. */
export const bowlMesh = (scene: Scene, name: string, at: Vector3, radius: number, squash: number): Mesh => {
  const m = MeshBuilder.CreateSphere(name, { diameter: 2, segments: 16, slice: 0.5 }, scene)
  m.rotation.x = Math.PI // an upside-down dome is a bowl
  m.position.copyFrom(at)
  m.scaling.set(radius, radius * squash, radius)
  m.isPickable = false
  return m
}

/** Share of the lower half of a room shell that shows through (40% transparency). */
export const ROOM_FLOOR_ALPHA = 0.6

/** The see-through twin of a room colour, for the lower half of the shell. */
export const glassOf = (solid: StandardMaterial): StandardMaterial => {
  const m = solid.clone(`${solid.name}:glass`)
  m.alpha = ROOM_FLOOR_ALPHA
  return m
}

/**
 * A closed room shell: the lower half (a bowl, see-through) holds the contents, the upper half
 * (a dome, solid) is the ceiling. Both `radius` wide and `squash` of that high, split at `at`.
 */
export const roomShell = (scene: Scene, name: string, at: Vector3, radius: number, squash: number): { floor: Mesh; ceiling: Mesh } => {
  const floor = bowlMesh(scene, `${name}:floor`, at, radius, squash)
  const ceiling = MeshBuilder.CreateSphere(`${name}:ceiling`, { diameter: 2, segments: 16, slice: 0.5 }, scene)
  ceiling.position.copyFrom(at)
  ceiling.scaling.set(radius, radius * squash, radius)
  ceiling.isPickable = false
  return { floor, ceiling }
}

/** Deterministic scatter on the floor of a room, so contents don't jump on redraw. */
const scatter = (i: number, radius: number): Vector3 => {
  const a = i * 2.399963 // golden angle
  const r = radius * 0.8 * Math.sqrt(((i * 0.618034) % 1) * 0.9 + 0.05)
  const y = -radius * 0.55 + ((i * 0.37) % 1) * radius * 0.35
  return new Vector3(Math.cos(a) * r, y, Math.sin(a) * r)
}

/** Contents drawn in one room: `count` items scattered in it (squashed in height). */
interface Group {
  at: Vector3
  radius: number
  squash: number
  count: number
  fill: number
}

export class NestView {
  private seeds: Mesh
  private brood: Mesh
  private queen: Mesh[] = []
  private queenRoom: Mesh
  private queenCeiling: Mesh
  private galleries: (Mesh | null)[] = []
  private ceilings: (Mesh | null)[] = []
  private glassMats = {} as Record<RoomLook, StandardMaterial>
  private tunnels: Mesh[] = []
  private exitShafts: Mesh[] = []
  private exitRims: Mesh[] = []
  private tunnelMat: StandardMaterial
  private roomMats = {} as Record<RoomLook, StandardMaterial>
  private exitCount = 0
  private exitMat: StandardMaterial
  private seedKey = ''
  private broodKey = ''
  private seedCount = 0
  private broodCount = 0
  /** Which view is on: the underground (rooms, tunnels, contents) or the surface. */
  private under = false

  constructor(
    private scene: Scene,
    private colony: Colony,
  ) {
    ;(Object.keys(ROOM_TINT) as RoomLook[]).forEach((k) => {
      this.roomMats[k] = bowlMaterial(scene, `room:${k}`, ROOM_TINT[k], k === 'free' ? 0 : 0.4)
      this.glassMats[k] = glassOf(this.roomMats[k])
    })
    this.tunnelMat = plain(scene, 'tunnel', new Color3(0.4, 0.3, 0.2), 0.3)
    this.tunnelMat.backFaceCulling = false
    this.tunnelMat.twoSidedLighting = true
    this.exitMat = plain(scene, 'exit', new Color3(0.36, 0.26, 0.17), 0.15)

    const queenShell = roomShell(scene, 'room:queen', TASK_POSITIONS.QueenCare, ROOM_RADIUS, QUEEN_SQUASH)
    this.queenRoom = queenShell.floor
    this.queenRoom.material = this.glassMats.queen
    this.queenCeiling = queenShell.ceiling
    this.queenCeiling.material = this.roomMats.queen

    // Seeds and brood: one mesh each, many thin instances (cheap however many there are).
    this.seeds = MeshBuilder.CreateSphere('room:seeds', { diameterX: 1.4, diameterY: 0.8, diameterZ: 1, segments: 6 }, scene)
    this.seeds.material = plain(scene, 'seeds', new Color3(0.78, 0.62, 0.34))
    this.seeds.isPickable = false
    this.brood = MeshBuilder.CreateSphere('room:brood', { diameterX: 0.9, diameterY: 1.4, diameterZ: 0.9, segments: 6 }, scene)
    this.brood.material = plain(scene, 'brood', new Color3(0.95, 0.93, 0.85), 0.45)
    this.brood.isPickable = false

    // The queen: a large ant (head, thorax, big abdomen), resting in her chamber.
    const queenMat = plain(scene, 'queen', new Color3(0.42, 0.2, 0.12), 0.25)
    const q = TASK_POSITIONS.QueenCare
    const size = 1.6 * S
    ;([
      [0, 0.9, 0.9],
      [1.3, 0.7, 0.7],
      [2.4, 0.55, 0.55],
    ] as const).forEach(([dx, d, h], i) => {
      const part = MeshBuilder.CreateSphere(`queen:${i}`, { diameterX: d * (i === 0 ? 2.2 : 1.2), diameterY: h, diameterZ: d }, scene)
      part.position.set(q.x - (dx - 1) * size, q.y - ROOM_RADIUS * QUEEN_SQUASH * 0.6, q.z)
      part.scaling.setAll(size)
      part.material = queenMat
      part.isPickable = false
      this.queen.push(part)
    })

    this.setUnderground(false)
  }

  /** Show the underground (true), or nothing of it (false: the surface view). */
  setUnderground(on: boolean): void {
    this.under = on
    ;[this.queenRoom, this.queenCeiling, ...this.queen, ...this.tunnels, ...this.exitShafts].forEach((m) => m.setEnabled(on))
    this.galleries.forEach((m) => m?.setEnabled(on))
    this.ceilings.forEach((m) => m?.setEnabled(on))
    this.seeds.setEnabled(on && this.seedCount > 0)
    this.brood.setEnabled(on && this.broodCount > 0)
  }

  /** Called every frame by the colony view. */
  update(): void {
    const colony = this.colony

    // The founding chamber first, then every dug room with that role.
    const net = colony.digNetwork
    const queen = TASK_POSITIONS.QueenCare
    const groups = (role: 'store' | 'brood', founding: number, count: (fill: number) => number, max: number): Group[] => [
      { at: queen, radius: ROOM_RADIUS, squash: QUEEN_SQUASH, count: Math.min(max, count(founding)), fill: founding },
      ...net
        .filter((n) => n.role === role && n.fill > 0)
        .map((n) => ({ at: n.pos, radius: n.room, squash: ROOM_SQUASH, count: Math.min(max, count(n.fill)), fill: n.fill })),
    ]
    const seedGroups = groups('store', FOUNDING.store, (f) => Math.round(Math.sqrt(f) * 1.3), MAX_SEEDS)
    const seedKey = seedGroups.map((g) => g.count).join(',')
    if (seedKey !== this.seedKey) {
      this.seedKey = seedKey
      this.seedCount = this.fill(this.seeds, seedGroups, 1.1 * S)
    }
    const broodGroups = groups('brood', FOUNDING.brood, (f) => Math.round(f), MAX_BROOD)
    const broodKey = broodGroups.map((g) => g.count).join(',')
    if (broodKey !== this.broodKey) {
      this.broodKey = broodKey
      this.broodCount = this.fill(this.brood, broodGroups, 0.9 * S)
    }

    // The queen breathes, slowly.
    const breath = 1 + 0.04 * Math.sin(performance.now() / 700)
    this.queen[2]?.scaling.setAll(1.6 * S * breath)

    // The tunnel network grows: every tunnel the diggers opened, from its parent node, ending
    // in the chamber they dug there.
    while (this.galleries.length < net.length) {
      const i = this.galleries.length
      const node = net[i]
      if (node.parent < 0) {
        this.galleries.push(null)
        this.ceilings.push(null)
        continue
      }
      const tunnel = cordTube(this.scene, `dig:tunnel:${i}`, [net[node.parent].pos, ...node.via, node.pos])
      tunnel.material = this.tunnelMat
      tunnel.setEnabled(this.under)
      this.tunnels.push(tunnel)
      const shell = roomShell(this.scene, `dig:chamber:${i}`, node.pos, node.room, ROOM_SQUASH)
      shell.floor.setEnabled(this.under)
      shell.ceiling.setEnabled(this.under)
      this.galleries.push(shell.floor)
      this.ceilings.push(shell.ceiling)
    }
    // A room's colour follows its role (one role per room; free rooms are plain earth).
    net.forEach((node, i) => {
      const look: RoomLook = node.role ?? (this.isFront(node.pos) ? 'digging' : 'free')
      const floor = this.galleries[i]
      if (floor) floor.material = this.glassMats[look]
      const ceiling = this.ceilings[i]
      if (ceiling) ceiling.material = this.roomMats[look]
    })

    // Exits: a short shaft from the tunnel tip up to the ground, and a crater rim of dug-out
    // soil around the hole, like the nest's own entrance but smaller. Rims show in both views.
    while (this.exitCount < colony.exits.length) {
      const i = this.exitCount++
      const exit = colony.exits[i]
      const tip = net[exit.node].pos
      const shaft = cordTube(this.scene, `exit:shaft:${i}`, [tip, exit.surface])
      shaft.material = this.tunnelMat
      shaft.setEnabled(this.under)
      this.exitShafts.push(shaft)
      const rim = MeshBuilder.CreateTorus(`exit:rim:${i}`, { diameter: 5 * S, thickness: 1.6 * S, tessellation: 20 }, this.scene)
      rim.position.set(exit.surface.x, exit.surface.y + 0.2 * S, exit.surface.z)
      rim.scaling.y = 0.45
      rim.rotationQuaternion = groundTilt(groundAt, exit.surface.x, exit.surface.z, 3 * S)
      rim.material = this.exitMat
      rim.isPickable = false
      const hole = MeshBuilder.CreateDisc(`exit:hole:${i}`, { radius: 1.6 * S, tessellation: 16 }, this.scene)
      hole.position.set(exit.surface.x, exit.surface.y + 0.25 * S, exit.surface.z)
      hole.rotationQuaternion = groundTilt(groundAt, exit.surface.x, exit.surface.z, 3 * S).multiply(Quaternion.RotationAxis(Vector3.Right(), Math.PI / 2))
      hole.material = plain(this.scene, `exit:hole:${i}`, new Color3(0.08, 0.06, 0.04), 0)
      hole.isPickable = false
      this.exitRims.push(rim)
    }
  }

  /** Is this the room at the digging front (the one being dug now)? */
  private isFront(pos: Vector3): boolean {
    return Vector3.DistanceSquared(pos, TASK_POSITIONS.Expansion) < 0.25
  }

  /** What belongs to a task underground, for the task highlight. */
  glowMeshes(task: Focus): Mesh[] {
    const rooms = (role: 'brood' | 'store' | 'sleep'): Mesh[] =>
      this.colony.digNetwork.flatMap((n, i) =>
        n.role === role ? [this.galleries[i], this.ceilings[i]].filter((m): m is Mesh => m !== null && m !== undefined) : [],
      )
    const enabled = (m: Mesh): Mesh[] => (m.isEnabled() ? [m] : [])
    switch (task) {
      case 'QueenCare':
        return [this.queenRoom, this.queenCeiling, ...this.queen]
      case 'EggLarvePupeaCare':
        return [...enabled(this.brood), ...rooms('brood'), ...(FOUNDING.brood > 0 ? [this.queenRoom] : [])]
      case 'Store':
        return [...enabled(this.seeds), ...rooms('store'), ...(FOUNDING.store > 0 ? [this.queenRoom] : [])]
      case 'Sleep':
        return rooms('sleep')
      case 'Expansion': {
        const front = this.colony.digNetwork.flatMap((n, i) =>
          n.role === null && this.isFront(n.pos) ? [this.galleries[i], this.ceilings[i]].filter((m): m is Mesh => !!m) : [],
        )
        return [...front, ...this.tunnels, ...this.exitShafts, ...this.exitRims]
      }
      default:
        return []
    }
  }

  /** Lay out a room's contents; returns how many items were placed. */
  private fill(mesh: Mesh, groups: Group[], size: number): number {
    const count = groups.reduce((sum, g) => sum + g.count, 0)
    if (count === 0) {
      mesh.thinInstanceCount = 0
      mesh.setEnabled(false)
      return 0
    }
    mesh.setEnabled(this.under)
    const m = new Float32Array(count * 16)
    let k = 0
    groups.forEach((g) => {
      for (let i = 0; i < g.count; i++, k++) {
        const p = scatter(i, g.radius)
        p.y *= g.squash
        p.addInPlace(g.at)
        Matrix.Compose(new Vector3(size, size, size), Quaternion.RotationAxis(Vector3.Up(), i * 1.3), p).copyToArray(m, k * 16)
      }
    })
    mesh.thinInstanceSetBuffer('matrix', m, 16)
    return count
  }
}
