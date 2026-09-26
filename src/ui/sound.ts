import { getSpeed } from '../commons/simClock'
import { HUNGER_TARGET_RESERVE_MIN } from '../constants'
import type { Colony } from '../model/colony'
import { TASK_HEX } from './palette'
import { createToasts } from './toasts'

// Sound for what the 3D view hides: rare, colony-level turning points that happen off-screen
// or only show in the HUD. Never individual events (encounters run at ~90 per sim second).
//
//   food spot emptied · new food spot found · store running low / empty / recovered ·
//   new generation
//
// Off by default (browsers also refuse audio before a user gesture). One cue per state
// CHANGE, never repeated while a state lasts; at most one cue every MIN_GAP_MS of real time,
// the most important winning; silent while paused. Tones are synthesised (Web Audio) on a
// pentatonic set so two cues that do overlap never clash. Every cue mirrors something the
// HUD already shows, so sound is never the only signal.

const STORAGE_KEY = 'ant-sim:sound'
const MIN_GAP_MS = 3000
const POLL_MS = 500
const MASTER_GAIN = 0.16
/**
 * Births and deaths: tiny, quiet ticks on their own lane (they never delay a cue), capped
 * at TICKS_PER_SECOND of real time shared between both, so at high speed you hear a sample
 * in the right proportion. More high ticks than low tocks = the colony is growing.
 */
const TICKS_PER_SECOND = 4
/** Store counts as recovered only well above the low line, so it doesn't flicker. */
const RECOVER_FACTOR = 1.4

type CueName = 'storeEmpty' | 'storeLow' | 'spotEmptied' | 'spotFound' | 'storeRecovered' | 'season' | 'generation' | 'exit'
type TickName = 'born' | 'died'

const TICKS: Record<TickName, Note> = {
  born: { freq: 1175, at: 0, dur: 0.07, gain: 0.12 }, // soft high tick
  died: { freq: 196, at: 0, dur: 0.12, gain: 0.18, type: 'triangle' }, // soft low tock
}

const PRIORITY: Record<CueName, number> = {
  storeEmpty: 6,
  storeLow: 5,
  spotEmptied: 4,
  spotFound: 3,
  storeRecovered: 2,
  season: 1.5,
  exit: 1.2,
  generation: 1,
}

interface Note {
  freq: number
  at: number // seconds after the cue starts
  dur: number
  gain: number
  type?: OscillatorType
}

// D minor pentatonic-ish set: D3 147, C3 131, E4 330, G4 392, A4 440, C5 523, G5 784, A5 880.
const CUES: Record<CueName, Note[]> = {
  // Low, muted falling pair: something ran out.
  spotEmptied: [
    { freq: 440, at: 0, dur: 0.35, gain: 0.5, type: 'triangle' },
    { freq: 330, at: 0.18, dur: 0.55, gain: 0.45, type: 'triangle' },
  ],
  // Soft rising pair: something was found.
  spotFound: [
    { freq: 523, at: 0, dur: 0.25, gain: 0.35 },
    { freq: 784, at: 0.12, dur: 0.45, gain: 0.3 },
  ],
  // One low, slow tone: the store is getting thin.
  storeLow: [{ freq: 147, at: 0, dur: 1.1, gain: 0.8 }],
  // Two low pulses, stepping down: the store is empty, ants will starve.
  storeEmpty: [
    { freq: 147, at: 0, dur: 0.5, gain: 0.85 },
    { freq: 131, at: 0.55, dur: 0.9, gain: 0.85 },
  ],
  // Gentle resolve: back above the line.
  storeRecovered: [
    { freq: 392, at: 0, dur: 0.3, gain: 0.3 },
    { freq: 523, at: 0.15, dur: 0.6, gain: 0.3 },
  ],
  // Soft three-note turn: a new season.
  season: [
    { freq: 392, at: 0, dur: 0.35, gain: 0.25 },
    { freq: 440, at: 0.14, dur: 0.35, gain: 0.22 },
    { freq: 523, at: 0.28, dur: 0.6, gain: 0.22 },
  ],
  // Two quick rising notes: the diggers broke through to the surface.
  exit: [
    { freq: 330, at: 0, dur: 0.2, gain: 0.3 },
    { freq: 523, at: 0.1, dur: 0.4, gain: 0.25 },
  ],
  // Single faint bell with an octave overtone: a new generation.
  generation: [
    { freq: 880, at: 0, dur: 1.8, gain: 0.25 },
    { freq: 1760, at: 0, dur: 1.2, gain: 0.08 },
  ],
}

const readPref = (): boolean => {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'on'
  } catch {
    return false
  }
}

const writePref = (on: boolean): void => {
  try {
    localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off')
  } catch {
    /* storage unavailable: preference just won't persist */
  }
}

class ColonySound {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private lastPlayed = -Infinity
  private pending: CueName | null = null
  private flushTimer: number | null = null
  private tickBudget = TICKS_PER_SECOND
  private tickRefilledAt = performance.now()
  enabled = readPref()

  /** Must run inside a user gesture the first time (autoplay policy). */
  private ensureContext(): boolean {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return false
      this.ctx = new Ctor()
      this.master = this.ctx.createGain()
      this.master.gain.value = MASTER_GAIN
      // Soft low-pass keeps every tone round rather than beepy.
      const tone = this.ctx.createBiquadFilter()
      tone.type = 'lowpass'
      tone.frequency.value = 2400
      this.master.connect(tone).connect(this.ctx.destination)
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    return true
  }

  setEnabled(on: boolean): void {
    this.enabled = on
    writePref(on)
    // A quiet "sound is on" confirmation, once the browser has actually unlocked audio.
    if (on && this.ensureContext()) void this.ctx!.resume().then(() => this.playNow('spotFound'))
  }

  /** Called on any user gesture, so a remembered "on" preference can actually start. */
  unlock(): void {
    if (this.enabled) this.ensureContext()
  }

  cue(name: CueName): void {
    if (!this.enabled || getSpeed() === 0) return
    const now = performance.now()
    if (now - this.lastPlayed >= MIN_GAP_MS && !this.pending) {
      this.playNow(name)
      return
    }
    // Inside the gap: keep only the most important cue, play it when the gap ends.
    if (!this.pending || PRIORITY[name] > PRIORITY[this.pending]) this.pending = name
    if (this.flushTimer === null) {
      const wait = Math.max(0, MIN_GAP_MS - (now - this.lastPlayed))
      this.flushTimer = window.setTimeout(() => {
        this.flushTimer = null
        const next = this.pending
        this.pending = null
        if (next && this.enabled && getSpeed() > 0) this.playNow(next)
      }, wait)
    }
  }

  tick(name: TickName): void {
    if (!this.enabled || getSpeed() === 0 || !this.ctx || this.ctx.state !== 'running') return
    const now = performance.now()
    this.tickBudget = Math.min(TICKS_PER_SECOND, this.tickBudget + ((now - this.tickRefilledAt) / 1000) * TICKS_PER_SECOND)
    this.tickRefilledAt = now
    if (this.tickBudget < 1) return
    this.tickBudget -= 1
    this.play([TICKS[name]])
  }

  private playNow(name: CueName): void {
    if (!this.ctx || !this.master || this.ctx.state !== 'running') return
    this.lastPlayed = performance.now()
    this.play(CUES[name])
  }

  private play(notes: Note[]): void {
    if (!this.ctx || !this.master) return
    const t0 = this.ctx.currentTime + 0.02
    notes.forEach((n) => {
      const osc = this.ctx!.createOscillator()
      const env = this.ctx!.createGain()
      osc.type = n.type ?? 'sine'
      osc.frequency.value = n.freq
      const start = t0 + n.at
      // Soft attack, exponential release: no clicks.
      env.gain.setValueAtTime(0.0001, start)
      env.gain.exponentialRampToValueAtTime(n.gain, start + Math.min(0.06, n.dur / 3))
      env.gain.exponentialRampToValueAtTime(0.0001, start + n.dur)
      osc.connect(env).connect(this.master!)
      osc.start(start)
      osc.stop(start + n.dur + 0.05)
    })
  }
}

type StoreState = 'ok' | 'low' | 'empty'

/**
 * Watch the colony for the few state changes worth hearing. Returns the speaker toggle for
 * the Controls panel to place.
 */
export const createSound = (colony: Colony): HTMLButtonElement => {
  const sound = new ColonySound()
  const toasts = createToasts()
  const toast = toasts.show

  // Every turning point is heard (if sound is on) AND shown (always): sound is never the
  // only signal. The text is taken from the colony at the moment it happens.
  const emit = (name: CueName, removed = false): void => {
    sound.cue(name)
    const spotCount = colony.foodSpots.length
    const known = colony.foodSpotsKnown
    const reserve = colony.reserveMinutes
    const food = TASK_HEX.Collect
    switch (name) {
      case 'spotEmptied':
        toast({
          kind: name,
          title: removed ? 'A food spot ran out, not replaced' : 'A food spot ran out',
          detail: removed ? `poorer environment · ${known}/${spotCount} spots known` : `${known}/${spotCount} spots still known`,
          color: food,
        })
        break
      case 'spotFound':
        toast({ kind: name, title: 'New food spot found', detail: `${known}/${spotCount} spots known`, color: food })
        break
      case 'storeLow':
        toast({ kind: name, title: 'Food store running low', detail: `${reserve.toFixed(1)} min of food left`, color: '#c3c2b7' })
        break
      case 'storeEmpty':
        toast({ kind: name, title: 'Food store empty', detail: 'ants will starve · the queen stops laying', color: '#ffffff' })
        break
      case 'storeRecovered':
        toast({ kind: name, title: 'Food store recovered', detail: `${reserve.toFixed(1)} min of food`, color: '#8a8980' })
        break
      case 'season': {
        const s = colony.season.name
        const detail: Record<string, string> = {
          Spring: 'food returns · the queen lays again',
          Summer: 'food peaks · stores spoil faster',
          Autumn: 'food thins · ants rest more',
          Winter: 'little food · the queen nearly stops · most ants rest',
        }
        const color: Record<string, string> = { Spring: '#8fbf7a', Summer: '#e2bf5a', Autumn: '#d98b4a', Winter: '#a8bde0' }
        toast({ kind: name, title: `${s} begins`, detail: detail[s] ?? '', color: color[s] ?? '#c3c2b7' })
        break
      }
      case 'exit':
        toast({
          kind: name,
          title: 'New anthill exit',
          detail: `a tunnel broke through · ${colony.exits.length} exit${colony.exits.length === 1 ? '' : 's'} besides the nest`,
          color: TASK_HEX.Expansion,
        })
        break
      case 'generation':
        toast({ kind: name, title: `Generation ${maxGeneration}`, detail: `${colony.ants.length} ants alive`, color: '#c3c2b7' })
        break
    }
  }

  // --- speaker toggle -----------------------------------------------------------
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'hud-sound'
  const paint = (): void => {
    button.classList.toggle('is-on', sound.enabled)
    button.setAttribute('aria-pressed', String(sound.enabled))
    button.setAttribute('aria-label', sound.enabled ? 'Sound on' : 'Sound off')
    button.title = sound.enabled
      ? 'Sound on: food found or run out, store low or empty, new generation · soft ticks for births, tocks for deaths'
      : 'Sound off: click for quiet cues on colony turning points'
  }
  button.innerHTML = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    <path d="M2 6h3l4-3v10l-4-3H2z" fill="currentColor"/>
    <path class="hud-sound-waves" d="M11 5.5a3.5 3.5 0 0 1 0 5M12.8 3.8a6 6 0 0 1 0 8.4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
    <path class="hud-sound-mute" d="M11 6l4 4M15 6l-4 4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
  </svg>`
  button.onclick = () => {
    sound.setEnabled(!sound.enabled)
    paint()
  }
  paint()
  const unlock = (): void => sound.unlock()
  window.addEventListener('pointerdown', unlock, { passive: true })
  window.addEventListener('keydown', unlock)

  // --- turning points ----------------------------------------------------------
  // New spot found: a (spot, epoch) that no living ant knew becomes known.
  const knownSpots = new Set<string>()
  const key = (id: number, epoch: number): string => `${id}:${epoch}`
  let store: StoreState = 'ok'
  let maxGeneration = 1

  // Births and deaths: chained onto whatever the view already listens for.
  colony.events.born = ((previous) => () => {
    previous?.()
    sound.tick('born')
    toasts.pulse(1)
  })(colony.events.born)
  colony.events.died = ((previous) => (at) => {
    previous?.(at)
    sound.tick('died')
    toasts.pulse(-1)
  })(colony.events.died)

  colony.events.seasonChanged = ((previous) => (name) => {
    previous?.(name)
    emit('season')
  })(colony.events.seasonChanged)

  colony.events.foodSiteMoved = ((previous) => (at, amount) => {
    previous?.(at, amount)
    // amount 0 = the spot was removed, not moved (a poorer environment doesn't replace it).
    emit('spotEmptied', amount === 0)
  })(colony.events.foodSiteMoved)

  colony.events.exitDug = ((previous) => (at) => {
    previous?.(at)
    emit('exit')
  })(colony.events.exitDug)

  window.setInterval(() => {
    if (colony.ants.length === 0) return

    const nowKnown = new Set<string>()
    colony.ants.forEach((a) => {
      const m = a.foodMemory
      if (m && m.epoch === m.spot.epoch && m.spot.remaining > 0) nowKnown.add(key(m.spot.id, m.epoch))
    })
    let found = false
    nowKnown.forEach((k) => {
      if (!knownSpots.has(k)) found = true
    })
    knownSpots.clear()
    nowKnown.forEach((k) => knownSpots.add(k))
    if (found) emit('spotFound')

    const reserve = colony.reserveMinutes
    const next: StoreState =
      colony.food <= 0 ? 'empty' : reserve < HUNGER_TARGET_RESERVE_MIN ? 'low' : reserve > HUNGER_TARGET_RESERVE_MIN * RECOVER_FACTOR ? 'ok' : store === 'empty' ? 'low' : store
    if (next !== store) {
      if (next === 'empty') emit('storeEmpty')
      else if (next === 'low' && store === 'ok') emit('storeLow')
      else if (next === 'ok') emit('storeRecovered')
      store = next
    }

    const generation = Math.max(...colony.ants.map((a) => a.data.generation))
    if (generation > maxGeneration) {
      maxGeneration = generation
      emit('generation')
    }
  }, POLL_MS)

  return button
}
