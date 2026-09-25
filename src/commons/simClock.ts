// Simulation clock. Replaces Date.now()/setInterval inside the model so the whole
// colony (timers, lifetimes, Babylon animations) can be sped up, slowed down or paused
// from one place. At speed 1 the timings match the original wall-clock behaviour.

interface Timer {
  due: number
  period: number | null
  fn: () => void
}

// Browsers clamp setInterval/setTimeout to ~4ms; keep the same floor so a 0ms
// interval does not spin.
const MIN_PERIOD_MS = 4
// Catch-up cap per timer per frame, so a very high speed cannot freeze the tab.
const MAX_FIRES_PER_ADVANCE = 64
// Ignore huge frame gaps (tab in background) instead of fast-forwarding through them.
const MAX_FRAME_MS = 100

export const SPEED_STEPS = [0, 0.25, 0.5, 1, 2, 4, 8, 16] as const

let simTime = 0
let speed = 1
let nextId = 1
const timers = new Map<number, Timer>()
const listeners = new Set<(speed: number) => void>()

export type SimTimer = number

export const simNow = (): number => simTime

export const getSpeed = (): number => speed

export const setSpeed = (value: number): void => {
  speed = Math.max(0, value)
  listeners.forEach((l) => l(speed))
}

export const onSpeedChange = (listener: (speed: number) => void): void => {
  listeners.add(listener)
  listener(speed)
}

const schedule = (fn: () => void, ms: number, repeat: boolean): SimTimer => {
  const period = Math.max(MIN_PERIOD_MS, ms || 0)
  const id = nextId++
  timers.set(id, { due: simTime + period, period: repeat ? period : null, fn })
  return id
}

export const simSetInterval = (fn: () => void, ms: number): SimTimer => schedule(fn, ms, true)

export const simSetTimeout = (fn: () => void, ms: number): SimTimer => schedule(fn, ms, false)

export const simClearTimer = (id: SimTimer | null | undefined): void => {
  if (id != null) timers.delete(id)
}

/** Advance sim time by one rendered frame. Call once per frame with the real delta. */
export const advance = (realMs: number): void => {
  if (speed === 0) return
  simTime += Math.min(realMs, MAX_FRAME_MS) * speed

  const due = [...timers.entries()].filter(([, t]) => t.due <= simTime).sort((a, b) => a[1].due - b[1].due)
  for (const [id, t] of due) {
    let fires = 0
    while (timers.get(id) === t && t.due <= simTime && fires < MAX_FIRES_PER_ADVANCE) {
      fires++
      if (t.period === null) {
        timers.delete(id)
        t.fn()
        break
      }
      t.due += t.period
      t.fn()
    }
    if (timers.get(id) === t && t.period !== null && t.due <= simTime) t.due = simTime + t.period
  }
}
