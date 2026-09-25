import type Ant from '../classes/ant'
import { SPEED_STEPS, getSpeed, onSpeedChange, setSpeed } from '../commons/simClock'
import { AUTODISCOVERING, EGG_FOOD_COST, POPULATION_CAP, QUEEN_EGGS_PER_MIN_MAX, TaskName } from '../constants'
import type { Colony, LayLimit } from '../model/colony'
import { TASK_HEX, TASK_LABEL, TASK_ORDER } from './palette'
import '../assets/css/hud.css'

export interface HudSource {
  colony: Colony
  onHighlight?: (task: TaskName | null) => void
}

// Demand bar is log2(need / actual), clamped: full arm = 8× over- or under-served.
const DEMAND_CLAMP = 3
const REFRESH_MS = 250
const COLLAPSE_KEY = 'ant-sim:hud-collapsed'
// Food reserve bar is full at this many minutes of colony consumption.
const RESERVE_FULL_MIN = 10
const LAY_LIMIT_NOTE: Record<LayLimit, string> = {
  food: 'food-limited',
  care: 'care-limited',
  cap: 'at cap',
  none: 'full speed',
}

interface Row {
  el: HTMLElement
  count: HTMLElement
  work: HTMLElement
  sleep: HTMLElement
  demand: HTMLElement
  known: HTMLElement
  seg: HTMLElement
}

interface TaskSnapshot {
  ants: number
  asleep: number
  known: number
}

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const el = document.createElement(tag)
  if (cls) el.className = cls
  if (text !== undefined) el.textContent = text
  return el
}

const meter = (label: string): { el: HTMLElement; fill: HTMLElement; value: HTMLElement } => {
  const el = h('div', 'hud-stat')
  const fill = h('div', 'hud-meter-fill')
  const track = h('div', 'hud-meter')
  const value = h('span', 'hud-stat-value')
  track.append(fill)
  el.append(h('span', 'hud-stat-label', label), track, value)
  return { el, fill, value }
}

const fmt = (n: number, digits = 2): string => (Number.isFinite(n) ? n.toFixed(digits) : '—')
const pct = (n: number): string => `${Math.round(n * 100)}%`

const readCollapsed = (): boolean => {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1'
  } catch {
    return false
  }
}

const writeCollapsed = (value: boolean): void => {
  try {
    localStorage.setItem(COLLAPSE_KEY, value ? '1' : '0')
  } catch {
    /* storage unavailable — collapse state just won't persist */
  }
}

export const createHud = (src: HudSource): void => {
  const root = h('aside', 'hud')
  root.setAttribute('aria-label', 'Colony state')
  if (readCollapsed()) root.classList.add('is-collapsed')

  const header = h('header', 'hud-header')
  const toggle = h('button', 'hud-toggle')
  toggle.type = 'button'
  toggle.setAttribute('aria-label', 'Toggle panel')
  toggle.onclick = () => {
    const collapsed = root.classList.toggle('is-collapsed')
    writeCollapsed(collapsed)
  }
  header.append(h('h1', 'hud-title', 'Anthill'), toggle)

  // --- Speed ----------------------------------------------------------------
  const speedRow = h('div', 'hud-speed')
  const play = h('button', 'hud-play')
  play.type = 'button'
  const slider = h('input', 'hud-slider')
  slider.type = 'range'
  slider.min = '0'
  slider.max = `${SPEED_STEPS.length - 1}`
  slider.step = '1'
  slider.setAttribute('aria-label', 'Simulation speed')
  const speedValue = h('output', 'hud-speed-value')
  speedRow.append(play, slider, speedValue)

  const oneX = SPEED_STEPS.indexOf(1)
  let lastRunningStep = oneX
  const stepOf = (speed: number): number => {
    const i = SPEED_STEPS.findIndex((v) => v === speed)
    return i === -1 ? oneX : i
  }
  const setStep = (i: number): void => setSpeed(SPEED_STEPS[Math.max(0, Math.min(SPEED_STEPS.length - 1, i))])
  const togglePause = (): void => setStep(getSpeed() === 0 ? lastRunningStep : 0)

  slider.addEventListener('input', () => setStep(Number(slider.value)))
  play.onclick = togglePause
  onSpeedChange((speed) => {
    const i = stepOf(speed)
    if (speed > 0) lastRunningStep = i
    slider.value = `${i}`
    const paused = speed === 0
    speedValue.textContent = paused ? 'Paused' : `${speed}×`
    play.classList.toggle('is-paused', paused)
    play.setAttribute('aria-label', paused ? 'Resume' : 'Pause')
    play.title = `${paused ? 'Resume' : 'Pause'} (Space) · slower/faster: [ ]`
    slider.setAttribute('aria-valuetext', speedValue.textContent)
  })

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement && e.target !== slider) return
    // Let focused controls (About sections, buttons, links) keep their own Space/Enter.
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

  const body = h('div', 'hud-body')

  // --- Colony -------------------------------------------------------------
  const colony = h('section', 'hud-section')
  const population = meter('Population')
  const asleepMeter = meter('Asleep')
  const active = meter('Reached nest')
  const knowledge = meter('Map known')
  // Births and deaths per minute on one shared scale, so the longer bar wins at a glance.
  // (Was "Died" as a share of everyone ever born, which always creeps to 100%.)
  const bornRate = meter('Born / min')
  const diedRate = meter('Died / min')
  const generation = h('div', 'hud-stat')
  const generationValue = h('span', 'hud-stat-value hud-stat-value--big')
  const generationSpan = h('span', 'hud-stat-note')
  generation.append(h('span', 'hud-stat-label', 'Generation'), generationSpan, generationValue)
  colony.append(population.el, asleepMeter.el, active.el)
  if (AUTODISCOVERING) colony.append(knowledge.el)
  colony.append(bornRate.el, diedRate.el, generation)

  // --- Food & queen -----------------------------------------------------------
  const economy = h('section', 'hud-section')
  const reserve = meter('Food reserve')
  const laying = meter('Egg laying')
  const layNote = h('p', 'hud-note hud-note--tight')
  economy.append(h('h2', 'hud-heading', 'Food & queen'), reserve.el, laying.el, layNote)

  // --- Allocation (stacked) -------------------------------------------------
  const allocation = h('section', 'hud-section')
  const stack = h('div', 'hud-stack')
  allocation.append(h('h2', 'hud-heading', 'Workforce allocation'), stack)

  // --- Per task -------------------------------------------------------------
  const tasks = h('section', 'hud-section')
  const tasksHead = h('div', 'hud-task-head')
  const demandHead = h('span', 'hud-demand-head')
  demandHead.append(h('span', '', '◂ over'), h('span', '', 'under ▸'))
  tasksHead.append(h('span', '', 'Task'), h('span', '', 'Workforce'), demandHead)
  demandHead.title = 'Demand vs supply'
  tasks.append(tasksHead)

  const rows = {} as Record<TaskName, Row>
  TASK_ORDER.forEach((task) => {
    const el = h('div', 'hud-task')
    el.style.setProperty('--task', TASK_HEX[task])
    el.tabIndex = 0

    const name = h('span', 'hud-task-name')
    name.append(h('i', 'hud-swatch'), h('span', '', TASK_LABEL[task]))

    const workCell = h('span', 'hud-work')
    const workTrack = h('span', 'hud-bar')
    const work = h('span', 'hud-bar-fill')
    const sleep = h('span', 'hud-bar-fill hud-bar-fill--asleep')
    const known = h('span', 'hud-known')
    const count = h('span', 'hud-count')
    workTrack.append(work, sleep)
    workCell.append(workTrack, count)

    const demandTrack = h('span', 'hud-demand')
    const demand = h('span', 'hud-demand-fill')
    demandTrack.append(demand, h('span', 'hud-demand-mid'))

    el.append(name, workCell, demandTrack)
    if (AUTODISCOVERING) el.append(known)
    const enter = (): void => {
      showTip(task, el)
      src.onHighlight?.(task)
    }
    const leave = (): void => {
      hideTip()
      src.onHighlight?.(null)
    }
    el.addEventListener('mouseenter', enter)
    el.addEventListener('focus', enter)
    el.addEventListener('mouseleave', leave)
    el.addEventListener('blur', leave)
    tasks.append(el)

    const seg = h('span', 'hud-stack-seg')
    seg.style.setProperty('--task', TASK_HEX[task])
    stack.append(seg)

    rows[task] = { el, count, work, sleep, demand, known, seg }
  })
  const asleepSeg = h('span', 'hud-stack-seg hud-stack-seg--asleep')
  asleepSeg.style.setProperty('--task', '#5a5a55')
  stack.append(asleepSeg)

  const legend = h(
    'p',
    'hud-note',
    'Workforce: solid = awake, faded = asleep. Right bar: need ÷ actual, log scale (full arm = 8×), centre = balanced. Underline: share of ants that know the site. Hover a task to highlight it in 3D.',
  )
  tasks.append(legend)

  const tip = h('div', 'hud-tip')
  tip.setAttribute('role', 'tooltip')

  body.append(colony, economy, allocation, tasks)
  root.append(header, speedRow, body)
  document.body.append(root, tip)

  // --- Live state -----------------------------------------------------------
  let snapshot = {} as Record<TaskName, TaskSnapshot>
  let tipTask: TaskName | null = null
  let tipAnchor: HTMLElement | null = null
  let maxGeneration = 1

  const takeSnapshot = (ants: Ant[]): Record<TaskName, TaskSnapshot> => {
    const snap = Object.fromEntries(TASK_ORDER.map((t) => [t, { ants: 0, asleep: 0, known: 0 }])) as Record<
      TaskName,
      TaskSnapshot
    >
    ants.forEach((ant) => {
      const behaviour = ant.data.behaviour
      snap[behaviour.actualTask.type].ants++
      if (ant.isSleeping) snap[behaviour.actualTask.type].asleep++
      TASK_ORDER.forEach((t) => {
        if (behaviour.discoveredPositions[t]) snap[t].known++
      })
    })
    return snap
  }

  const renderTip = (): void => {
    if (!tipTask || !tipAnchor) return
    const n = src.colony.needs[tipTask]
    const s = snapshot[tipTask]
    const total = src.colony.ants.length || 1
    const lines: [string, string][] = [
      ['Ants on task', `${s?.ants ?? 0}`],
      ['of which asleep', `${s?.asleep ?? 0}`],
      ['dedicated_ants', `${n.dedicated_ants}`],
      ['need', fmt(n.need)],
      ['actual', fmt(n.actual)],
      ['urgency', fmt(n.urgency, 3)],
    ]
    if (AUTODISCOVERING) lines.push(['Location known by', pct((s?.known ?? 0) / total)])
    tip.replaceChildren(
      h('strong', '', TASK_LABEL[tipTask]),
      ...lines.map(([k, v]) => {
        const row = h('div', 'hud-tip-row')
        row.append(h('span', '', k), h('span', 'hud-tip-value', v))
        return row
      }),
    )
    // Beside the row when there is room (desktop), otherwise just below it (phone).
    const r = tipAnchor.getBoundingClientRect()
    const fitsRight = r.right + 12 + tip.offsetWidth <= window.innerWidth
    const left = fitsRight ? r.right + 12 : Math.max(8, r.left)
    const top = fitsRight ? Math.min(r.top, window.innerHeight - tip.offsetHeight - 8) : r.bottom + 4
    tip.style.transform = `translate(${left}px, ${top}px)`
  }

  function showTip(task: TaskName, anchor: HTMLElement): void {
    tipTask = task
    tipAnchor = anchor
    tip.classList.add('is-visible')
    renderTip()
  }

  function hideTip(): void {
    tipTask = null
    tipAnchor = null
    tip.classList.remove('is-visible')
  }

  const update = (): void => {
    const colony = src.colony
    const ants = colony.ants
    const total = ants.length
    snapshot = takeSnapshot(ants)

    const sleeping = TASK_ORDER.reduce((acc, t) => acc + snapshot[t].asleep, 0)
    const activeCount = colony.activeAnts
    population.fill.style.width = pct(total / POPULATION_CAP)
    population.value.textContent = `${total}`
    population.el.title = `${total} alive · performance cap ${POPULATION_CAP} (the real limit is food)`
    asleepMeter.fill.style.width = pct(total ? sleeping / total : 0)
    asleepMeter.value.textContent = `${sleeping}`
    active.fill.style.width = pct(total ? Math.min(activeCount / total, 1) : 0)
    active.value.textContent = `${activeCount}`

    const rateScale = Math.max(1, colony.birthsPerMin, colony.deathsPerMin)
    bornRate.fill.style.width = pct(colony.birthsPerMin / rateScale)
    bornRate.value.textContent = colony.birthsPerMin.toFixed(1)
    bornRate.el.title = `${colony.births} born in total (3-minute average shown)`
    diedRate.fill.style.width = pct(colony.deathsPerMin / rateScale)
    diedRate.value.textContent = colony.deathsPerMin.toFixed(1)
    const oldAge = colony.deaths - colony.diedOutside - colony.starved
    diedRate.el.title =
      `${colony.deaths} died in total: ${oldAge} old age, ${colony.diedOutside} outside the nest, ` +
      `${colony.starved} starved (3-minute average shown)`

    const reserveMin = colony.reserveMinutes
    reserve.fill.style.width = pct(Math.min(1, reserveMin / RESERVE_FULL_MIN))
    // With no ants the reserve is "infinite minutes"; show the bar empty rather than full.
    const extinct = total === 0
    if (extinct) reserve.fill.style.width = '0%'
    reserve.value.textContent = extinct ? '—' : colony.food <= 0 ? 'empty' : `${reserveMin.toFixed(1)}m`
    reserve.el.classList.toggle('is-empty', !extinct && colony.food <= 0)
    reserve.el.title =
      `${colony.food.toFixed(0)} food · per minute: +${colony.intakePerMin.toFixed(0)} collected, ` +
      `−${colony.consumptionPerMin.toFixed(0)} eaten, −${colony.spoilagePerMin.toFixed(1)} spoiled`
    // An egg costs food: with an empty store the queen is effectively not laying.
    const layRate = extinct || colony.food < EGG_FOOD_COST ? 0 : colony.layRate
    laying.fill.style.width = pct(layRate / QUEEN_EGGS_PER_MIN_MAX)
    laying.value.textContent = `${layRate.toFixed(1)}/m`
    layNote.textContent = extinct
      ? 'Colony extinct'
      : colony.food < EGG_FOOD_COST
        ? 'Queen not laying: no food'
        : `Queen ${LAY_LIMIT_NOTE[colony.layLimit]}`

    // Newest generation born so far; the note shows which generations are alive.
    let oldest = Infinity
    let newest = 0
    ants.forEach((a) => {
      oldest = Math.min(oldest, a.data.generation)
      newest = Math.max(newest, a.data.generation)
    })
    maxGeneration = Math.max(maxGeneration, newest)
    generationValue.textContent = `${maxGeneration}`
    generationSpan.textContent = total ? (oldest === newest ? `alive: ${oldest}` : `alive: ${oldest}–${newest}`) : 'extinct'

    if (AUTODISCOVERING) {
      const knownSum = TASK_ORDER.reduce((acc, t) => acc + snapshot[t].known, 0)
      const knownShare = total ? knownSum / (total * TASK_ORDER.length) : 0
      knowledge.fill.style.width = pct(knownShare)
      knowledge.value.textContent = pct(knownShare)
    }

    const maxAnts = Math.max(1, ...TASK_ORDER.map((t) => snapshot[t].ants))
    TASK_ORDER.forEach((task) => {
      const row = rows[task]
      const s = snapshot[task]
      const { need, actual } = colony.needs[task]
      const ratio = actual > 0 ? need / actual : Number.POSITIVE_INFINITY
      const log = ratio > 0 ? Math.log2(ratio) : -DEMAND_CLAMP
      const d = Math.max(-DEMAND_CLAMP, Math.min(DEMAND_CLAMP, Number.isFinite(log) ? log : DEMAND_CLAMP))
      const half = (Math.abs(d) / DEMAND_CLAMP) * 50

      row.work.style.width = pct((s.ants - s.asleep) / maxAnts)
      row.sleep.style.width = pct(s.asleep / maxAnts)
      row.count.textContent = `${s.ants}`
      row.demand.style.left = d >= 0 ? '50%' : `${50 - half}%`
      row.demand.style.width = `${half}%`
      row.demand.classList.toggle('is-under', d > 0)
      row.el.classList.toggle('is-starved', d >= DEMAND_CLAMP)
      if (AUTODISCOVERING) row.known.style.width = pct(total ? s.known / total : 0)

      const awakeOnTask = s.ants - s.asleep
      row.seg.style.flexGrow = `${awakeOnTask}`
      row.seg.hidden = awakeOnTask === 0
      row.seg.title = `${TASK_LABEL[task]}: ${awakeOnTask} awake (${pct(total ? awakeOnTask / total : 0)})`
    })
    asleepSeg.style.flexGrow = `${sleeping}`
    asleepSeg.hidden = sleeping === 0
    asleepSeg.title = `Asleep: ${sleeping} (${pct(total ? sleeping / total : 0)})`

    renderTip()
  }

  update()
  setInterval(update, REFRESH_MS)
}
