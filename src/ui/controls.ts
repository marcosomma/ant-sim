import { SPEED_STEPS, getSpeed, onSpeedChange, setSpeed } from '../commons/simClock'
import { SEASONS } from '../constants'
import type { Colony } from '../model/colony'
import type { NestLayer } from '../scenes/colonyView'

/** What the controls need from the 3D view: the Surface / Underground switch. */
export interface ViewSwitch {
  readonly view: NestLayer
  setView(view: NestLayer): void
  onViewChange(listener: (shown: NestLayer) => void): void
}
import '../assets/css/hud.css'

// Everything you can SET lives here; the Anthill panel only REPORTS. A slim bar at the
// bottom centre: time (pause + speed), season (four points + cycle), sound.

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const el = document.createElement(tag)
  if (cls) el.className = cls
  if (text !== undefined) el.textContent = text
  return el
}

const stepSlider = (label: string, steps: number): HTMLInputElement => {
  const slider = h('input', 'hud-slider')
  slider.type = 'range'
  slider.min = '0'
  slider.max = `${steps - 1}`
  slider.step = '1'
  slider.setAttribute('aria-label', label)
  return slider
}

export const createControls = (colony: Colony, soundButton: HTMLButtonElement, viewSwitch: ViewSwitch): void => {
  const root = h('aside', 'hud controls')
  root.setAttribute('aria-label', 'Simulation controls')

  // --- Time -----------------------------------------------------------------
  const time = h('div', 'controls-group')
  const play = h('button', 'hud-play')
  play.type = 'button'
  const speed = stepSlider('Simulation speed', SPEED_STEPS.length)
  const speedValue = h('output', 'controls-value')
  time.append(play, speed, speedValue)

  const oneX = SPEED_STEPS.indexOf(1)
  let lastRunningStep = oneX
  const stepOf = (value: number): number => {
    const i = SPEED_STEPS.findIndex((v) => v === value)
    return i === -1 ? oneX : i
  }
  const setStep = (i: number): void => setSpeed(SPEED_STEPS[Math.max(0, Math.min(SPEED_STEPS.length - 1, i))])
  const togglePause = (): void => setStep(getSpeed() === 0 ? lastRunningStep : 0)

  speed.addEventListener('input', () => setStep(Number(speed.value)))
  play.onclick = togglePause
  onSpeedChange((value) => {
    const i = stepOf(value)
    if (value > 0) lastRunningStep = i
    speed.value = `${i}`
    const paused = value === 0
    speedValue.textContent = paused ? 'Paused' : `${value}×`
    play.classList.toggle('is-paused', paused)
    play.setAttribute('aria-label', paused ? 'Resume' : 'Pause')
    play.title = `${paused ? 'Resume' : 'Pause'} (Space) · slower/faster: [ ]`
    speed.setAttribute('aria-valuetext', speedValue.textContent)
  })

  window.addEventListener('keydown', (e) => {
    // Typing in a text field, or a focused control using its own keys: leave it alone.
    if (e.target instanceof HTMLInputElement && !e.target.classList.contains('hud-slider')) return
    if (e.target instanceof HTMLElement && e.target.closest('summary, button, a')) return
    if (e.code === 'Space') {
      e.preventDefault()
      togglePause()
    } else if (e.key === '[') {
      setStep(stepOf(getSpeed()) - 1)
    } else if (e.key === ']') {
      setStep(stepOf(getSpeed()) + 1)
    }
  })

  // --- Seasons: four fixed points + cycle ------------------------------------
  // Click a season to set it. Cycle on: the year carries on turning from there. Cycle off:
  // the colony stays in that season, with all its factors (food, eating, laying, rest).
  const seasons = h('div', 'controls-group controls-seasons')
  seasons.setAttribute('role', 'group')
  seasons.setAttribute('aria-label', 'Season')
  // Same colours as the season notifications.
  const SEASON_HEX: Record<string, string> = { Spring: '#8fbf7a', Summer: '#e2bf5a', Autumn: '#d98b4a', Winter: '#a8bde0' }
  const points = SEASONS.map((season, i) => {
    const b = h('button', 'controls-season')
    b.type = 'button'
    b.style.setProperty('--season', SEASON_HEX[season.name])
    const live = h('i', 'controls-season-live')
    const name = h('span', 'controls-season-name', season.name)
    const bar = h('span', 'controls-season-progress')
    b.append(live, name, bar)
    b.title =
      `${season.name}: food ×${season.food}, eating ×${season.eat}, laying ×${season.lay}, ` +
      `rest ×${season.rest}, spoilage ×${season.spoil}`
    b.onclick = () => {
      colony.setSeason(i)
      paintSeason()
    }
    seasons.append(b)
    return { b, bar }
  })
  const cycle = h('button', 'controls-toggle', 'Cycle')
  cycle.type = 'button'
  cycle.onclick = () => {
    colony.setSeasonMode(colony.seasonMode === 'cycle' ? 'hold' : 'cycle')
    paintSeason()
  }
  seasons.append(cycle)

  const paintSeason = (): void => {
    const cycling = colony.seasonMode === 'cycle'
    const current = colony.seasonIndex
    points.forEach(({ b, bar }, i) => {
      const on = i === current
      b.classList.toggle('is-current', on)
      b.setAttribute('aria-pressed', String(on))
      bar.style.width = on && cycling ? `${Math.round(colony.season.progress * 100)}%` : on ? '100%' : '0%'
    })
    seasons.classList.toggle('is-cycling', cycling)
    cycle.classList.toggle('is-on', cycling)
    cycle.setAttribute('aria-pressed', String(cycling))
    cycle.title = cycling
      ? `The year turns: 40 sim minutes, 10 per season (food now ×${colony.effectiveFood.toFixed(2)}). Click to hold this season.`
      : `Holding ${colony.season.name} (food ×${colony.effectiveFood.toFixed(2)}). Click to let the year turn again.`
  }
  paintSeason()
  window.setInterval(paintSeason, 500)

  // --- View: surface or underground -----------------------------------------
  // Two solid layers instead of one see-through one. The view also goes underground on its
  // own while the camera is below the ground or an underground task is highlighted: then the
  // Underground point is lit but hollow ("for now").
  const layers = h('div', 'controls-group controls-seasons')
  layers.setAttribute('role', 'group')
  layers.setAttribute('aria-label', 'View')
  const LAYERS: { view: NestLayer; label: string; hex: string; title: string }[] = [
    { view: 'surface', label: 'Surface', hex: '#8fbf7a', title: 'Surface: the ground is solid; the dug nest shows as darker soil (U)' },
    { view: 'underground', label: 'Underground', hex: '#c9a27a', title: 'Underground: rooms, tunnels and what is in them; the surface fades overhead (U)' },
  ]
  let shown: NestLayer = 'surface'
  const layerButtons = LAYERS.map(({ view, label, hex, title }) => {
    const b = h('button', 'controls-season')
    b.type = 'button'
    b.style.setProperty('--season', hex)
    b.title = title
    b.append(h('i', 'controls-season-live'), h('span', 'controls-season-name', label))
    b.onclick = () => viewSwitch.setView(view)
    layers.append(b)
    return { view, b }
  })
  const paintLayers = (): void => {
    layerButtons.forEach(({ view, b }) => {
      const on = view === shown
      b.classList.toggle('is-current', on)
      b.classList.toggle('is-auto', on && view !== viewSwitch.view)
      b.setAttribute('aria-pressed', String(view === viewSwitch.view))
    })
  }
  viewSwitch.onViewChange((v) => {
    shown = v
    paintLayers()
  })
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement && !e.target.classList.contains('hud-slider')) return
    if (e.key === 'u' || e.key === 'U') {
      viewSwitch.setView(viewSwitch.view === 'surface' ? 'underground' : 'surface')
      paintLayers()
    }
  })
  layerButtons.forEach(({ b }) => b.addEventListener('click', paintLayers))
  paintLayers()

  // --- Sound ----------------------------------------------------------------
  const sound = h('div', 'controls-group controls-group--end')
  sound.append(soundButton)

  root.append(time, h('span', 'controls-rule'), seasons, h('span', 'controls-rule'), layers, h('span', 'controls-rule'), sound)
  document.body.append(root)
}
