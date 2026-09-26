// Terrain: a heightmap the colony lives on. Pure data (no rendering), so the same terrain
// drives the browser and headless runs. Phase 1 of routes: ants walk ON it, following its
// height and slowing uphill. (Phase 2 adds obstacles, phase 3 trails.)
//
// Heights come from fractal value noise: a few octaves of smoothly interpolated random
// lattices, which gives rolling hills and hollows without any assets. The nest area is
// flattened, because a colony digs its mound on level ground and the chambers sit under it.

export interface Terrain {
  /** Half the side of the square the terrain covers, centred on the nest. */
  half: number
  /** Grid resolution (cells per side). */
  size: number
  /** Height at world (x, z), bilinear between grid points; 0 outside the terrain. */
  heightAt(x: number, z: number): number
  /** Height samples, row-major, (size + 1)² values from (−half, −half). */
  heights: Float32Array
  /** Water fills everything below this height. */
  waterLevel: number
  /** Rock outcrops (impassable). */
  rocks: { x: number; z: number; r: number }[]
  /** Can an ant stand here? (Not in water, not in rock, inside the terrain.) */
  passable(x: number, z: number): boolean
  /**
   * The cheapest walkable route from (x, z) to the nest, as waypoints ending at the nest.
   * Empty if (x, z) cannot reach the nest. Cost counts distance and climbing.
   */
  routeToNest(x: number, z: number): { x: number; z: number }[]
  /** Planned route between any two points (A* on the route grid); empty if unreachable. */
  routeBetween(ax: number, az: number, bx: number, bz: number): { x: number; z: number }[]
  /** The route grid, for trails and step-by-step walking. */
  nav: {
    size: number
    cell: number
    blocked: Uint8Array
    cellOf(x: number, z: number): number
    centerX(c: number): number
    centerZ(c: number): number
    /** Walkable neighbours of a cell (8-way, no corner cutting past obstacles). */
    neighbours(c: number): number[]
  }
}

export interface TerrainOptions {
  half: number
  size: number
  /** Tallest hills, in world units. */
  amplitude: number
  /** Width of the biggest hills, in world units. */
  wavelength: number
  /** Radius around the nest kept flat, and the width of the ramp back to full relief. */
  flatRadius: number
  flatRamp: number
  seed?: number
  /** Share of the land under water (the lowest hollows fill first). */
  waterShare: number
  rockCount: number
  rockRadius: [number, number]
  /** No obstacles closer to the nest than this. */
  clearRadius: number
  /** Rocks are scattered no further than this from the nest. */
  rockReach: number
  /** Route cost of climbing: step × (1 + slopeCost × grade). */
  slopeCost: number
  /** Route grid resolution (cells per side). */
  navSize: number
}

/** Tiny binary heap keyed by cost, for Dijkstra. */
class Heap {
  private keys: number[] = []
  private items: number[] = []
  get size(): number {
    return this.items.length
  }
  push(item: number, key: number): void {
    this.items.push(item)
    this.keys.push(key)
    let i = this.items.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (this.keys[p] <= this.keys[i]) break
      ;[this.keys[p], this.keys[i]] = [this.keys[i], this.keys[p]]
      ;[this.items[p], this.items[i]] = [this.items[i], this.items[p]]
      i = p
    }
  }
  pop(): number {
    const top = this.items[0]
    const lastItem = this.items.pop()!
    const lastKey = this.keys.pop()!
    if (this.items.length > 0) {
      this.items[0] = lastItem
      this.keys[0] = lastKey
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < this.items.length && this.keys[l] < this.keys[m]) m = l
        if (r < this.items.length && this.keys[r] < this.keys[m]) m = r
        if (m === i) break
        ;[this.keys[m], this.keys[i]] = [this.keys[i], this.keys[m]]
        ;[this.items[m], this.items[i]] = [this.items[i], this.items[m]]
        i = m
      }
    }
    return top
  }
}

// Small, fast seeded PRNG (mulberry32), so a terrain can be reproduced from its seed.
const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const smooth = (t: number): number => t * t * (3 - 2 * t)

/** One octave of value noise on a lattice of `cells` × `cells`, sampled at (u, v) ∈ [0, 1]. */
const valueNoise = (random: () => number, cells: number): ((u: number, v: number) => number) => {
  const lattice = new Float32Array((cells + 1) * (cells + 1)).map(() => random() * 2 - 1)
  const at = (i: number, j: number): number => lattice[j * (cells + 1) + i]
  return (u, v) => {
    const x = Math.min(cells - 1e-6, Math.max(0, u * cells))
    const y = Math.min(cells - 1e-6, Math.max(0, v * cells))
    const i = Math.floor(x)
    const j = Math.floor(y)
    const fx = smooth(x - i)
    const fy = smooth(y - j)
    const top = at(i, j) + (at(i + 1, j) - at(i, j)) * fx
    const bottom = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * fx
    return top + (bottom - top) * fy
  }
}

export const createTerrain = (o: TerrainOptions): Terrain => {
  const random = mulberry32(o.seed ?? Math.floor(Math.random() * 2 ** 31))
  const baseCells = Math.max(2, Math.round((o.half * 2) / o.wavelength))
  // Three octaves: big hills, medium swells, small bumps.
  const octaves = [
    { noise: valueNoise(random, baseCells), weight: 1 },
    { noise: valueNoise(random, baseCells * 2), weight: 0.45 },
    { noise: valueNoise(random, baseCells * 4), weight: 0.2 },
  ]
  const total = octaves.reduce((sum, oc) => sum + oc.weight, 0)

  const n = o.size + 1
  const heights = new Float32Array(n * n)
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const u = i / o.size
      const v = j / o.size
      const x = -o.half + u * o.half * 2
      const z = -o.half + v * o.half * 2
      let h = 0
      octaves.forEach((oc) => (h += oc.noise(u, v) * oc.weight))
      h = (h / total) * o.amplitude
      // Level ground around the nest, ramping back to full relief.
      const d = Math.hypot(x, z)
      const k = smooth(Math.min(1, Math.max(0, (d - o.flatRadius) / o.flatRamp)))
      heights[j * n + i] = h * k
    }
  }

  const cell = (o.half * 2) / o.size
  const heightAt = (x: number, z: number): number => {
    const gx = (x + o.half) / cell
    const gz = (z + o.half) / cell
    if (gx < 0 || gz < 0 || gx > o.size || gz > o.size) return 0
    const i = Math.min(o.size - 1, Math.floor(gx))
    const j = Math.min(o.size - 1, Math.floor(gz))
    const fx = gx - i
    const fz = gz - j
    const h00 = heights[j * n + i]
    const h10 = heights[j * n + i + 1]
    const h01 = heights[(j + 1) * n + i]
    const h11 = heights[(j + 1) * n + i + 1]
    const top = h00 + (h10 - h00) * fx
    const bottom = h01 + (h11 - h01) * fx
    return top + (bottom - top) * fz
  }

  // --- obstacles ------------------------------------------------------------------
  // Water: the lowest waterShare of the (non-flat) land. Rocks: random outcrops in the
  // territory. Both are kept clear of the nest.
  const sorted = Array.from(heights).sort((a, b) => a - b)
  const waterLevel = Math.min(-1, sorted[Math.floor(o.waterShare * (sorted.length - 1))])
  const rocks: { x: number; z: number; r: number }[] = []
  for (let k = 0; k < o.rockCount * 20 && rocks.length < o.rockCount; k++) {
    const a = random() * Math.PI * 2
    const d = o.clearRadius + random() * (o.rockReach - o.clearRadius)
    const rock = { x: Math.cos(a) * d, z: Math.sin(a) * d, r: o.rockRadius[0] + random() * (o.rockRadius[1] - o.rockRadius[0]) }
    if (heightAt(rock.x, rock.z) < waterLevel) continue // no rocks in the pools
    if (rocks.some((q) => Math.hypot(q.x - rock.x, q.z - rock.z) < q.r + rock.r)) continue
    rocks.push(rock)
  }
  const passable = (x: number, z: number): boolean => {
    if (Math.abs(x) > o.half || Math.abs(z) > o.half) return false
    if (Math.hypot(x, z) < o.clearRadius) return true
    if (heightAt(x, z) < waterLevel) return false
    return !rocks.some((q) => Math.hypot(q.x - x, q.z - z) < q.r)
  }

  // --- routes to the nest -------------------------------------------------------------
  // One Dijkstra field from the nest over a coarse grid: every cell knows its cheapest cost
  // home. Walking home = stepping to the cheapest neighbour until the nest; walking out = the
  // same route reversed. Computed once (the terrain doesn't change), so it's cheap at 16×.
  const N = o.navSize
  const navCell = (o.half * 2) / N
  const cx = (i: number): number => -o.half + (i + 0.5) * navCell
  const idx = (i: number, j: number): number => j * N + i
  const blocked = new Uint8Array(N * N)
  // A cell is walkable only if ALL of it is clear (centre and corners), so walkers moving
  // between cell centres never clip the edge of a pool or a rock.
  const q = navCell * 0.5
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = cx(i)
      const z = cx(j)
      const clear =
        passable(x, z) && passable(x - q, z - q) && passable(x + q, z - q) && passable(x - q, z + q) && passable(x + q, z + q)
      blocked[idx(i, j)] = clear ? 0 : 1
    }
  }
  const cost = new Float32Array(N * N).fill(Infinity)
  const toCell = (x: number, z: number): number => {
    const i = Math.min(N - 1, Math.max(0, Math.floor((x + o.half) / navCell)))
    const j = Math.min(N - 1, Math.max(0, Math.floor((z + o.half) / navCell)))
    return idx(i, j)
  }
  const nestCell = toCell(0, 0)
  cost[nestCell] = 0
  const heap = new Heap()
  heap.push(nestCell, 0)
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
  while (heap.size > 0) {
    const u = heap.pop()
    const ui = u % N
    const uj = (u - ui) / N
    const hu = heightAt(cx(ui), cx(uj))
    for (const [di, dj] of DIRS) {
      const vi = ui + di
      const vj = uj + dj
      if (vi < 0 || vj < 0 || vi >= N || vj >= N) continue
      const v = idx(vi, vj)
      if (blocked[v]) continue
      // No cutting corners past an obstacle on a diagonal.
      if (di !== 0 && dj !== 0 && (blocked[idx(ui + di, uj)] || blocked[idx(ui, uj + dj)])) continue
      const step = navCell * Math.hypot(di, dj)
      // An ant going HOME walks v → u: it climbs if u is higher than v.
      const climb = Math.max(0, hu - heightAt(cx(vi), cx(vj))) / step
      const c = cost[u] + step * (1 + o.slopeCost * climb)
      if (c < cost[v]) {
        cost[v] = c
        heap.push(v, c)
      }
    }
  }

  const routeToNest = (x: number, z: number): { x: number; z: number }[] => {
    let c = toCell(x, z)
    if (!Number.isFinite(cost[c])) return []
    const path: { x: number; z: number }[] = []
    for (let guard = 0; guard < N * N && c !== nestCell; guard++) {
      const ci = c % N
      const cj = (c - ci) / N
      let best = c
      for (const [di, dj] of DIRS) {
        const vi = ci + di
        const vj = cj + dj
        if (vi < 0 || vj < 0 || vi >= N || vj >= N) continue
        const v = idx(vi, vj)
        if (cost[v] < cost[best]) best = v
      }
      if (best === c) break
      c = best
      const bi = c % N
      path.push({ x: cx(bi), z: cx((c - bi) / N) })
    }
    path.push({ x: 0, z: 0 })
    return path
  }

  const neighbours = (c: number): number[] => {
    const ci = c % N
    const cj = (c - ci) / N
    const out: number[] = []
    for (const [di, dj] of DIRS) {
      const vi = ci + di
      const vj = cj + dj
      if (vi < 0 || vj < 0 || vi >= N || vj >= N) continue
      if (blocked[idx(vi, vj)]) continue
      if (di !== 0 && dj !== 0 && (blocked[idx(ci + di, cj)] || blocked[idx(ci, cj + dj)])) continue
      out.push(idx(vi, vj))
    }
    return out
  }
  const centerX = (c: number): number => cx(c % N)
  const centerZ = (c: number): number => cx(Math.floor(c / N))

  // A* between two cells: distance + climbing, straight-line heuristic. Used only as the
  // walkers' safety valve (an ant hopelessly stuck behind an obstacle), so it can be modest.
  const routeBetween = (ax: number, az: number, bx: number, bz: number): { x: number; z: number }[] => {
    const start = toCell(ax, az)
    const goal = toCell(bx, bz)
    if (blocked[goal]) return []
    const g = new Map<number, number>([[start, 0]])
    const came = new Map<number, number>()
    const open = new Heap()
    const hx = centerX(goal)
    const hz = centerZ(goal)
    open.push(start, 0)
    const closed = new Set<number>()
    while (open.size > 0) {
      const u = open.pop()
      if (u === goal) break
      if (closed.has(u)) continue
      closed.add(u)
      const hu = heightAt(centerX(u), centerZ(u))
      for (const v of neighbours(u)) {
        const step = Math.hypot(centerX(v) - centerX(u), centerZ(v) - centerZ(u))
        const climb = Math.max(0, heightAt(centerX(v), centerZ(v)) - hu) / step
        const c = (g.get(u) ?? Infinity) + step * (1 + o.slopeCost * climb)
        if (c < (g.get(v) ?? Infinity)) {
          g.set(v, c)
          came.set(v, u)
          open.push(v, c + Math.hypot(centerX(v) - hx, centerZ(v) - hz))
        }
      }
    }
    if (!came.has(goal) && start !== goal) return []
    const path: { x: number; z: number }[] = [{ x: bx, z: bz }]
    for (let c = came.get(goal); c !== undefined && c !== start; c = came.get(c)) path.push({ x: centerX(c), z: centerZ(c) })
    return path.reverse()
  }

  return {
    half: o.half,
    size: o.size,
    heightAt,
    heights,
    waterLevel,
    rocks,
    passable,
    routeToNest,
    routeBetween,
    nav: { size: N, cell: navCell, blocked, cellOf: toCell, centerX, centerZ, neighbours },
  }
}
