import type { Terrain } from './terrain'

// Trails (routes, phase 3): stigmergy on the ground. A trail strength per route-grid cell.
// Walking ants lay trail as they go (strongly when coming home successful, faintly
// otherwise), trails fade with a half-life, and walkers prefer stronger trail when choosing
// their next step. Routes that work get walked more, so they get stronger; detours fade.
// No ant plans a route: the colony's routes are in the ground.

export class Trails {
  readonly strength: Float32Array
  /**
   * "No entry" marks, a second, repellent signal (Pharaoh ants lay one at unrewarding branches,
   * Robinson et al. 2005): an ant that got stuck marks the pocket it was circling, and others
   * steer clear of it while the mark lasts. Short-lived, so a pocket is only avoided while
   * it keeps trapping ants.
   */
  readonly noEntry: Float32Array
  /** Running max, for display normalisation. */
  peak = 0

  constructor(readonly terrain: Terrain) {
    this.strength = new Float32Array(terrain.nav.size * terrain.nav.size)
    this.noEntry = new Float32Array(terrain.nav.size * terrain.nav.size)
  }

  noEntryAt(cell: number): number {
    return this.noEntry[cell]
  }

  markNoEntry(cell: number, amount: number): void {
    if (cell >= 0 && cell < this.noEntry.length) this.noEntry[cell] += amount
  }

  /** Fade the no-entry marks (their own, shorter half-life). */
  decayNoEntry(dtMs: number, halfLifeMs: number): void {
    const k = Math.pow(0.5, dtMs / halfLifeMs)
    for (let i = 0; i < this.noEntry.length; i++) {
      const v = this.noEntry[i] * k
      this.noEntry[i] = v < 1e-3 ? 0 : v
    }
  }

  at(cell: number): number {
    return this.strength[cell]
  }

  deposit(x: number, z: number, amount: number): void {
    if (amount <= 0) return
    const c = this.terrain.nav.cellOf(x, z)
    this.strength[c] += amount
  }

  /** Fade every cell by the half-life (called on the economy tick). */
  decay(dtMs: number, halfLifeMs: number): void {
    const k = Math.pow(0.5, dtMs / halfLifeMs)
    let peak = 0
    for (let i = 0; i < this.strength.length; i++) {
      const v = this.strength[i] * k
      this.strength[i] = v < 1e-4 ? 0 : v
      if (v > peak) peak = v
    }
    this.peak = peak
  }
}
