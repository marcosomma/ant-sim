import { SPEED_STEPS, getSpeed, onSpeedChange, setSpeed } from '../commons/simClock'
import { FOOD_AVAILABILITY_STEPS } from '../constants'
import type { Colony } from '../model/colony'
import '../assets/css/hud.css'

// Everything you can SET lives here; the Anthill panel only REPORTS. A slim bar at the
// bottom centre: time (pause + speed), environment (food availability), sound.

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

const envName = (v: number): string =>
  v < 0.4 ? 'barren' : v < 0.7 ? 'scarce' : v < 0.95 ? 'lean' : v <= 1.05 ? 'normal' : v <= 1.6 ? 'rich' : 'abundant'

export const createControls = (colony: Colony, soundButton: HTMLButtonElement): void => {
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

  // --- Environment ----------------------------------------------------------
  // How rich the ground is, live: drag towards barren or abundant and watch the colony react.
  const env = h('div', 'controls-group')
  const envLabel = h('span', 'controls-label', 'Food')
  const envSlider = stepSlider('Food availability in the environment', FOOD_AVAILABILITY_STEPS.length)
  const envValue = h('output', 'controls-value controls-value--wide')
  env.append(envLabel, envSlider, envValue)
  const paintEnvironment = (): void => {
    const v = colony.foodAvailability
    const i = FOOD_AVAILABILITY_STEPS.findIndex((s) => Math.abs(s - v) < 1e-6)
    envSlider.value = `${i === -1 ? FOOD_AVAILABILITY_STEPS.indexOf(1) : i}`
    envValue.textContent = envName(v)
    envSlider.setAttribute('aria-valuetext', `${envName(v)}, ×${v}`)
    env.title =
      `Food availability ×${v} (${envName(v)}): how many food spots the ground holds and how much each ` +
      `new one carries. Richer shows at once; poorer sets in as spots run out.`
  }
  envSlider.addEventListener('input', () => {
    colony.setFoodAvailability(FOOD_AVAILABILITY_STEPS[Number(envSlider.value)])
    paintEnvironment()
  })
  paintEnvironment()

  // --- Sound ----------------------------------------------------------------
  const sound = h('div', 'controls-group controls-group--end')
  sound.append(soundButton)

  root.append(time, h('span', 'controls-rule'), env, h('span', 'controls-rule'), sound)
  document.body.append(root)
}
