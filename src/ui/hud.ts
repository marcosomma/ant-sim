import type Ant from '../classes/ant'
import {
  AUTODISCOVERING,
  EGG_FOOD_COST,
  POPULATION_CAP,
  QUEEN_EGGS_PER_MIN_MAX,
  TaskName,
} from '../constants'
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

/** Compact stat tile: label + value on one line, a mini bar, and a one-line detail. */
interface Tile {
  el: HTMLElement
  value: HTMLElement
  fill: HTMLElement
  detail: HTMLElement
}

const tile = (label: string, diverging = false): Tile => {
  const el = h('div', 'hud-tile')
  const top = h('div', 'hud-tile-top')
  const value = h('span', 'hud-tile-value')
  top.append(h('span', 'hud-tile-label', label), value)
  const track = h('div', diverging ? 'hud-meter hud-meter--diverge' : 'hud-meter')
  const fill = h('div', 'hud-meter-fill')
  track.append(fill)
  if (diverging) track.append(h('span', 'hud-meter-mid'))
  const detail = h('div', 'hud-tile-detail')
  el.append(top, track, detail)
  return { el, value, fill, detail }
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

  const body = h('div', 'hud-body')

  // --- Colony (2×2 tiles) ----------------------------------------------------
  const colony = h('section', 'hud-section')
  const population = tile('Population')
  // Births and deaths as ONE signed rate: bar centred on zero, left = shrinking.
  const growth = tile('Growth', true)
  const asleepTile = tile('Asleep')
  const knowledge = tile('Map known')
  const colonyTiles = h('div', 'hud-tiles')
  colonyTiles.append(population.el, growth.el, asleepTile.el)
  if (AUTODISCOVERING) colonyTiles.append(knowledge.el)
  colony.append(colonyTiles)

  // --- Food & queen (2×2 tiles) ------------------------------------------------
  const economy = h('section', 'hud-section')
  const reserve = tile('Reserve')
  const queen = tile('Queen')
  const spots = tile('Food spots')
  const territory = tile('Territory')
  const economyTiles = h('div', 'hud-tiles')
  economyTiles.append(reserve.el, queen.el, spots.el, territory.el)
  economy.append(h('h2', 'hud-heading', 'Food & queen'), economyTiles)

  // --- Per task -------------------------------------------------------------
  const tasks = h('section', 'hud-section')
  const tasksHead = h('div', 'hud-task-head')
  const demandHead = h('span', 'hud-demand-head')
  demandHead.append(h('span', '', '◂ over'), h('span', '', 'under ▸'))
  tasksHead.append(h('span', '', 'Task'), h('span', '', 'Workforce'), demandHead)
  demandHead.title = 'Demand vs supply'
  tasks.append(tasksHead)

  const rows = {} as Record<TaskName, Row>
  // Click pins a task (its ants stay singled out in 3D and their encounters show);
  // hover previews a task only while nothing is pinned.
  let pinned: TaskName | null = null
  const setPinned = (task: TaskName | null): void => {
    pinned = task
    TASK_ORDER.forEach((t) => {
      rows[t].el.classList.toggle('is-pinned', t === pinned)
      rows[t].el.setAttribute('aria-pressed', String(t === pinned))
    })
  }
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
    el.setAttribute('role', 'button')
    el.setAttribute('aria-pressed', 'false')
    el.title = 'Click to pin: keeps these ants highlighted and shows whom they meet'
    const enter = (): void => {
      showTip(task, el)
      if (!pinned) src.onHighlight?.(task)
    }
    const leave = (): void => {
      hideTip()
      src.onHighlight?.(pinned)
    }
    const togglePin = (): void => {
      setPinned(pinned === task ? null : task)
      src.onHighlight?.(pinned ?? task)
    }
    el.addEventListener('click', togglePin)
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') togglePin()
      if (e.key === 'Escape' && pinned) {
        setPinned(null)
        src.onHighlight?.(null)
      }
    })
    el.addEventListener('mouseenter', enter)
    el.addEventListener('focus', enter)
    el.addEventListener('mouseleave', leave)
    el.addEventListener('blur', leave)
    tasks.append(el)


    rows[task] = { el, count, work, sleep, demand, known }
  })

  const legend = h(
    'p',
    'hud-note',
    'Workforce: solid = awake, faded = asleep. Right bar: need ÷ actual, log scale (full arm = 8×), centre = balanced. Underline: share of ants that know the site. Hover a task to preview it in 3D; click to pin it and see whom its ants meet.',
  )
  tasks.append(legend)

  const tip = h('div', 'hud-tip')
  tip.setAttribute('role', 'tooltip')

  body.append(colony, economy, tasks)
  root.append(header, body)
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
    const extinct = total === 0

    // Population · generations alive · (reached nest in the tooltip: after start-up it equals population)
    let oldest = Infinity
    let newest = 0
    ants.forEach((a) => {
      oldest = Math.min(oldest, a.data.generation)
      newest = Math.max(newest, a.data.generation)
    })
    maxGeneration = Math.max(maxGeneration, newest)
    population.fill.style.width = pct(total / POPULATION_CAP)
    population.value.textContent = `${total}`
    population.detail.textContent = extinct
      ? 'extinct'
      : `gen ${maxGeneration} · alive ${oldest === newest ? oldest : `${oldest}–${newest}`}`
    population.el.title =
      `${total} alive (performance cap ${POPULATION_CAP}; the real limit is food) · ` +
      `${colony.activeAnts} have reached the nest · generation = one mean lifespan`

    // Growth: births − deaths per minute, one signed bar.
    const net = colony.birthsPerMin - colony.deathsPerMin
    const scale = Math.max(1, colony.birthsPerMin, colony.deathsPerMin)
    const half = (Math.min(1, Math.abs(net) / scale) * 50).toFixed(1)
    growth.fill.style.left = net >= 0 ? '50%' : `${50 - Number(half)}%`
    growth.fill.style.width = `${half}%`
    growth.fill.classList.toggle('is-negative', net < 0)
    growth.value.textContent = `${net >= 0 ? '+' : '−'}${Math.abs(net).toFixed(1)}/m`
    growth.detail.textContent = `${colony.birthsPerMin.toFixed(1)} born · ${colony.deathsPerMin.toFixed(1)} died`
    const oldAge = colony.deaths - colony.diedOutside - colony.starved
    growth.el.title =
      `Per minute (3-min average): ${colony.birthsPerMin.toFixed(1)} born, ${colony.deathsPerMin.toFixed(1)} died. ` +
      `In total: ${colony.births} born, ${colony.deaths} died (${oldAge} old age, ` +
      `${colony.diedOutside} outside the nest, ${colony.starved} starved)`

    asleepTile.fill.style.width = pct(total ? sleeping / total : 0)
    asleepTile.value.textContent = `${sleeping}`
    asleepTile.detail.textContent = `${pct(total ? sleeping / total : 0)} of the colony`

    if (AUTODISCOVERING) {
      const knownSum = TASK_ORDER.reduce((acc, t) => acc + snapshot[t].known, 0)
      const knownShare = total ? knownSum / (total * TASK_ORDER.length) : 0
      knowledge.fill.style.width = pct(knownShare)
      knowledge.value.textContent = pct(knownShare)
      knowledge.detail.textContent = 'avg per ant'
    }

    // Reserve: minutes of food at current consumption.
    const reserveMin = colony.reserveMinutes
    reserve.fill.style.width = extinct ? '0%' : pct(Math.min(1, reserveMin / RESERVE_FULL_MIN))
    reserve.value.textContent = extinct ? '—' : colony.food <= 0 ? 'empty' : `${reserveMin.toFixed(1)}m`
    reserve.el.classList.toggle('is-empty', !extinct && colony.food <= 0)
    reserve.detail.textContent = `+${colony.intakePerMin.toFixed(0)} in · −${colony.consumptionPerMin.toFixed(0)} eaten /m`
    reserve.el.title =
      `${colony.food.toFixed(0)} food stored · per minute: +${colony.intakePerMin.toFixed(0)} collected, ` +
      `−${colony.consumptionPerMin.toFixed(0)} eaten, −${colony.spoilagePerMin.toFixed(1)} spoiled`

    // Queen: laying rate, and what limits it. An egg costs food, so an empty store means 0.
    const layRate = extinct || colony.food < EGG_FOOD_COST ? 0 : colony.layRate
    queen.fill.style.width = pct(layRate / QUEEN_EGGS_PER_MIN_MAX)
    queen.value.textContent = `${layRate.toFixed(1)}/m`
    queen.detail.textContent = extinct ? 'colony extinct' : colony.food < EGG_FOOD_COST ? 'not laying: no food' : LAY_LIMIT_NOTE[colony.layLimit]
    queen.el.title = `Eggs per minute (max ${QUEEN_EGGS_PER_MIN_MAX}), limited by food reserve and queen care`

    // Food spots known out of spots on the ground; more appear as the territory grows.
    const spotCount = colony.foodSpots.length
    const spotsKnown = colony.foodSpotsKnown
    spots.fill.style.width = pct(spotCount ? spotsKnown / spotCount : 0)
    spots.value.textContent = `${spotsKnown}/${spotCount}`
    spots.detail.textContent = `known · ${colony.foodSitesDepleted} emptied`
    spots.el.title = `${spotsKnown} of ${spotCount} food spots known by at least one ant · ${colony.foodSitesDepleted} emptied so far`

    // Territory: expansion widens the dome and the foraging area (the dashed circle).
    territory.fill.style.width = pct(colony.expansionLevel)
    territory.value.textContent = `×${colony.foodReach.toFixed(1)}`
    territory.detail.textContent = `expansion ${pct(colony.expansionLevel)}`
    territory.el.title =
      `Expansion ${pct(colony.expansionLevel)} · foraging territory ×${colony.foodReach.toFixed(2)} ` +
      `(the dashed circle) · nest ${colony.nestDiameter.toFixed(0)} wide`

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
    })

    renderTip()
  }

  update()
  setInterval(update, REFRESH_MS)
}
