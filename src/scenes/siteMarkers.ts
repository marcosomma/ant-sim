import { Color3, Matrix, Mesh, MeshBuilder, Scene, StandardMaterial, TransformNode } from '@babylonjs/core'

import { SYMBOL_SCALE, TaskName } from '../constants'

// One silhouette per task site, built from primitives. Every marker follows the rule the
// food mounds set: the SHAPE says what the task is, and one level says how well it is
// supplied (actual ÷ need). 0 = nothing done, 1 = demand met, up to MAX_LEVEL = surplus.
// Fuller / taller always means better supplied, for every task, so one reading rule covers
// the whole scene.

export const MAX_LEVEL = 1.5
/** Height budget of a fully supplied marker, in world units (matches the old tanks). */
const H = 30

export interface SiteMarker {
  /** Shared material of the silhouette, so the view can make an under-served site breathe. */
  mat: StandardMaterial
  /** `level` = supply, clamped to [0, MAX_LEVEL] by the caller. */
  setLevel(level: number): void
}

const makeMaterial = (scene: Scene, name: string, color: Color3): StandardMaterial => {
  const mat = new StandardMaterial(name, scene)
  mat.diffuseColor = color.clone()
  mat.emissiveColor = color.scale(0.45)
  mat.specularColor = Color3.Black()
  mat.alpha = 0.95
  return mat
}

/** Unit-height cylinder with its origin at the bottom face, so scaling.y grows it upwards. */
const column = (name: string, diameter: number, scene: Scene, tessellation = 16): Mesh => {
  const mesh = MeshBuilder.CreateCylinder(name, { height: 1, diameter, tessellation }, scene)
  mesh.bakeTransformIntoVertices(Matrix.Translation(0, 0.5, 0))
  return mesh
}

/** Unit-height cone (point up) with its origin at the base. */
const cone = (name: string, diameter: number, scene: Scene, tessellation = 16): Mesh => {
  const mesh = MeshBuilder.CreateCylinder(name, { height: 1, diameterTop: 0, diameterBottom: diameter, tessellation }, scene)
  mesh.bakeTransformIntoVertices(Matrix.Translation(0, 0.5, 0))
  return mesh
}

const attach = (meshes: Mesh[], parent: TransformNode, mat: StandardMaterial): void =>
  meshes.forEach((m) => {
    m.parent = parent
    m.material = mat
    m.isPickable = false
  })

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

type Builder = (id: string, scene: Scene, parent: TransformNode, mat: StandardMaterial) => (level: number) => void

const BUILDERS: Record<Exclude<TaskName, 'Collect'>, Builder> = {
  // Palisade: guards standing around the site. Taller posts = better defended.
  Protection: (id, scene, parent, mat) => {
    const posts = Array.from({ length: 8 }, (_, i) => {
      const post = column(`${id}:post:${i}`, 1.3, scene, 8)
      const a = (i / 8) * Math.PI * 2
      post.position.set(Math.cos(a) * 4.2, 0.5, Math.sin(a) * 4.2)
      return post
    })
    attach(posts, parent, mat)
    return (level) => posts.forEach((p, i) => (p.scaling.y = lerp(1.5, H * 0.7, level / MAX_LEVEL) * (i % 2 ? 0.85 : 1)))
  },

  // Scout beacon: a mast with a cone on top. A taller mast = a territory better scouted.
  Exploration: (id, scene, parent, mat) => {
    const mast = column(`${id}:mast`, 0.9, scene, 8)
    mast.position.y = 0.5
    const tip = cone(`${id}:tip`, 4.5, scene, 12)
    attach([mast, tip], parent, mat)
    return (level) => {
      const h = lerp(3, H, level / MAX_LEVEL)
      mast.scaling.y = h
      tip.position.y = 0.5 + h
      tip.scaling.y = 5
    }
  },

  // The queen's chamber: a dome with a crown. A fuller dome = a queen well looked after.
  QueenCare: (id, scene, parent, mat) => {
    const dome = MeshBuilder.CreateSphere(`${id}:dome`, { diameter: 10, slice: 0.5, segments: 20 }, scene)
    dome.position.y = 0.5
    const crown = MeshBuilder.CreateTorus(`${id}:crown`, { diameter: 5, thickness: 0.7, tessellation: 24 }, scene)
    const points = Array.from({ length: 5 }, (_, i) => {
      const p = cone(`${id}:point:${i}`, 1.1, scene, 6)
      const a = (i / 5) * Math.PI * 2
      p.position.set(Math.cos(a) * 2.5, 0, Math.sin(a) * 2.5)
      p.scaling.y = 2
      p.parent = crown
      return p
    })
    attach([dome, crown], parent, mat)
    attach(points, crown, mat)
    return (level) => {
      const s = lerp(0.3, 1.5, level / MAX_LEVEL)
      dome.scaling.set(s, s, s)
      crown.position.y = 0.5 + 5 * s + 0.4
    }
  },

  // Brood: a cluster of eggs. Plumper eggs = brood well tended.
  EggLarvePupeaCare: (id, scene, parent, mat) => {
    const spots: [number, number][] = [
      [0, 0],
      [2.8, 0.8],
      [-2.4, 1.6],
      [0.6, -2.9],
      [-1.8, -2.1],
      [2.2, -2.2],
    ]
    const eggs = spots.map(([x, z], i) => {
      const egg = MeshBuilder.CreateSphere(`${id}:egg:${i}`, { diameterX: 2.6, diameterY: 3.8, diameterZ: 2.6, segments: 12 }, scene)
      egg.position.set(x, 0, z)
      return egg
    })
    attach(eggs, parent, mat)
    return (level) =>
      eggs.forEach((egg, i) => {
        const s = lerp(0.3, 2.2, level / MAX_LEVEL) * (i === 0 ? 1.15 : 1)
        egg.scaling.set(s, s, s)
        egg.position.y = 0.5 + 1.9 * s
      })
  },

  // Granary: a silo with a domed cap. A taller silo = more put away.
  Store: (id, scene, parent, mat) => {
    const silo = column(`${id}:silo`, 7, scene, 20)
    silo.position.y = 0.5
    const cap = MeshBuilder.CreateSphere(`${id}:cap`, { diameter: 7, slice: 0.5, segments: 16 }, scene)
    attach([silo, cap], parent, mat)
    return (level) => {
      const h = lerp(1.5, H * 0.8, level / MAX_LEVEL)
      silo.scaling.y = h
      cap.position.y = 0.5 + h
    }
  },

  // Earthworks: heaps of dug soil. Higher heaps = more digging done.
  Expansion: (id, scene, parent, mat) => {
    const heaps: [number, number, number][] = [
      [-2, -1, 6],
      [2.6, 1.2, 4.6],
      [0.4, 3, 3.6],
    ]
    const cones = heaps.map(([x, z, d], i) => {
      const c = cone(`${id}:heap:${i}`, d, scene, 7)
      c.position.set(x, 0.5, z)
      return c
    })
    attach(cones, parent, mat)
    return (level) => cones.forEach((c, i) => (c.scaling.y = lerp(0.8, H * 0.55, level / MAX_LEVEL) * [1, 0.75, 0.55][i]))
  },

  // Swept stones: a neat stack. More stones stacked = more cleaned up.
  Cleaning: (id, scene, parent, mat) => {
    const STONES = 7
    const stones = Array.from({ length: STONES }, (_, i) => {
      const stone = MeshBuilder.CreateCylinder(`${id}:stone:${i}`, { height: 2.4, diameter: 8 - i * 0.7, tessellation: 7 }, scene)
      stone.position.y = 0.5 + 1.2 + i * 2.7
      stone.rotation.y = i * 0.45
      return stone
    })
    attach(stones, parent, mat)
    return (level) => {
      const filled = (level / MAX_LEVEL) * STONES
      stones.forEach((stone, i) => {
        const part = Math.max(0, Math.min(1, filled - i))
        stone.setEnabled(part > 0.02)
        stone.scaling.set(1, part, 1)
      })
    }
  },
}

export const buildSiteMarker = (
  task: Exclude<TaskName, 'Collect'>,
  scene: Scene,
  parent: TransformNode,
  color: Color3,
): SiteMarker => {
  const mat = makeMaterial(scene, `site:${task}:marker`, color)
  // Built at reference size (world 300) and scaled as a whole, so every proportion holds.
  const holder = new TransformNode(`site:${task}:marker`, scene)
  holder.parent = parent
  holder.scaling.setAll(SYMBOL_SCALE)
  const setLevel = BUILDERS[task](`site:${task}`, scene, holder, mat)
  setLevel(0)
  return { mat, setLevel }
}
