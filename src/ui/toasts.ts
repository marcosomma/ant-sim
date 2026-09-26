import { getSpeed } from '../commons/simClock'
import '../assets/css/hud.css'

// Notifications for colony turning points, bottom-right: the visual twin of the sound cues,
// shown whether sound is on or not.
//
//   * Lifetime follows the SIM clock: a card lasts LIFE_SIM_MS of simulated time, kept
//     between MIN_REAL_MS and MAX_REAL_MS of real time so it is always readable. At 16× they
//     no longer sit there forever; paused, they freeze.
//   * Repeats of a kind PILE UP like a small deck (newest on top, up to two edges behind),
//     instead of printing ×N.
//   * Births and deaths get their own, lighter signal: a "+1" / "−1" that floats up and fades
//     just above the cards. Several in the same instant merge into one ("+3").

const LIFE_SIM_MS = 20_000
const MIN_REAL_MS = 1200
const MAX_REAL_MS = 6000
const MAX_GROUPS = 3
/** Births/deaths landing within this window merge into one marker. */
const PULSE_WINDOW_MS = 250

export interface ToastSpec {
  kind: string
  title: string
  detail: string
  /** Dot colour: the task colour it concerns, or a neutral tone. */
  color: string
}

interface Group {
  kind: string
  el: HTMLElement
  titleEl: HTMLElement
  detailEl: HTMLElement
  dot: HTMLElement
  size: number
  ageReal: number
  ageSim: number
}

export interface Toasts {
  show(spec: ToastSpec): void
  pulse(sign: 1 | -1): void
}

export const createToasts = (): Toasts => {
  const stack = document.createElement('div')
  stack.className = 'hud-toasts'
  stack.setAttribute('role', 'status')
  stack.setAttribute('aria-live', 'polite')
  // Birth/death markers float in a strip above the cards.
  const pulses = document.createElement('div')
  pulses.className = 'hud-pulses'
  pulses.setAttribute('aria-hidden', 'true')
  stack.append(pulses)
  document.body.append(stack)

  const groups: Group[] = []

  const dismiss = (g: Group): void => {
    const i = groups.indexOf(g)
    if (i !== -1) groups.splice(i, 1)
    g.el.classList.add('is-leaving')
    window.setTimeout(() => g.el.remove(), 250)
  }

  const paintPile = (g: Group): void => {
    g.el.dataset.pile = String(Math.min(g.size, 3))
  }

  const show = (spec: ToastSpec): void => {
    const same = groups.find((g) => g.kind === spec.kind)
    if (same) {
      // Joins the pile: newest text on top, fresh lifetime, a small bump so the change is seen.
      same.size++
      same.titleEl.textContent = spec.title
      same.detailEl.textContent = spec.detail
      same.dot.style.background = spec.color
      same.ageReal = 0
      same.ageSim = 0
      paintPile(same)
      same.el.classList.remove('is-bumped')
      void same.el.offsetWidth // restart the animation
      same.el.classList.add('is-bumped')
      return
    }
    if (groups.length >= MAX_GROUPS) dismiss(groups[0])

    const el = document.createElement('div')
    el.className = 'hud-toast'
    const dot = document.createElement('i')
    dot.className = 'hud-toast-dot'
    dot.style.background = spec.color
    const text = document.createElement('div')
    text.className = 'hud-toast-text'
    const titleEl = document.createElement('strong')
    titleEl.textContent = spec.title
    const detailEl = document.createElement('span')
    detailEl.textContent = spec.detail
    text.append(titleEl, detailEl)
    el.append(dot, text)
    stack.append(el)

    const g: Group = { kind: spec.kind, el, titleEl, detailEl, dot, size: 1, ageReal: 0, ageSim: 0 }
    el.addEventListener('click', () => dismiss(g))
    paintPile(g)
    groups.push(g)
  }

  // --- births / deaths ---------------------------------------------------------
  const pending = { up: 0, down: 0 }
  let flushAt = 0
  const flush = (): void => {
    flushAt = 0
    ;([
      [pending.up, 'is-up', '+'],
      [pending.down, 'is-down', '−'],
    ] as const).forEach(([n, cls, sign]) => {
      if (n <= 0) return
      const marker = document.createElement('span')
      marker.className = `hud-pulse ${cls}`
      marker.textContent = `${sign}${n}`
      // Births rise on the right, deaths just left of them, so both read at once.
      pulses.append(marker)
      marker.addEventListener('animationend', () => marker.remove())
    })
    pending.up = 0
    pending.down = 0
  }
  const pulse = (sign: 1 | -1): void => {
    if (sign > 0) pending.up++
    else pending.down++
    if (!flushAt) flushAt = window.setTimeout(flush, PULSE_WINDOW_MS)
  }

  // --- lifetimes on the sim clock ------------------------------------------------
  let last = performance.now()
  const tick = (now: number): void => {
    const dt = now - last
    last = now
    const speed = getSpeed()
    if (speed > 0) {
      ;[...groups].forEach((g) => {
        g.ageReal += dt
        g.ageSim += dt * speed
        if ((g.ageSim >= LIFE_SIM_MS && g.ageReal >= MIN_REAL_MS) || g.ageReal >= MAX_REAL_MS) dismiss(g)
      })
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)

  return { show, pulse }
}
