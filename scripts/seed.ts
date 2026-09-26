// Reproducible headless runs: SEED=<n> replaces Math.random with a seeded generator
// (mulberry32). Imported first by headless.ts, so the terrain and sites use it too.
const seed = Number(process.env.SEED)
if (Number.isFinite(seed) && process.env.SEED !== undefined) {
  let a = seed >>> 0
  Math.random = (): number => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
export {}
