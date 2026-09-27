import type Ant from '../classes/ant'
import { NestNeeds, TaskName } from '../constants'
import { TASK_ORDER } from '../ui/palette'

// Allocation metrics: how well the colony's self-allocation serves its needs, measured
// directly rather than through population. Sampled every economy tick (1 s of sim time),
// read by the HUD and by the headless runner. Never influences the model.
//
//   supply         actual ÷ need for a task right now (1 = balanced)
//   underShare     share of sampled time the task spent under-served (supply < 0.5)
//   trackingError  mean |log2(need ÷ actual)|: how far, on average, the task sat from balance
//   perceived      the encounter share of the task as seen by the ants ON it
//   trueShare      the task's real share of the awake workforce
//   bias           perceived ÷ true: 1 = encounters sample the colony fairly; > 1 = the task
//                  looks more crowded from inside than it is (a concentrated task)
//   churn          task switches per awake ant per minute (3-minute average)
//   reversals      share of recent switches undone within REVERSAL_MIN
//   shock          after a shock (see Colony.shock): minutes until the hit task's supply came
//                  back within ±25% of balance and stayed there 30 s, the overshoot on the way,
//                  and the herd (most ants joining the task in any 30 s window)

export type ShockKind = 'foragers' | 'food' | 'brood'
export const SHOCK_LABEL: Record<ShockKind, string> = {
  foragers: 'Half the foragers die',
  food: 'All known food gone',
  brood: 'Brood doubles',
}
export const SHOCK_TASK: Record<ShockKind, TaskName> = {
  foragers: 'Collect',
  food: 'Collect',
  brood: 'EggLarvePupeaCare',
}

export interface TaskMetrics {
  supply: number
  underShare: number
  trackingError: number
  perceived: number
  trueShare: number
  bias: number
  /** Time-average of `bias` over the run (while the task had anyone on it). */
  biasMean: number
  switchesIn: number
  switchesOut: number
}

export interface ShockRecord {
  kind: ShockKind
  task: TaskName
  at: number
  crewBefore: number
  supplyBefore: number
  /** Minutes to settle, or null while still out of balance. */
  responseMin: number | null
  overshoot: number
  herd: number
  /** Minutes observed so far. */
  elapsedMin: number
}

const SETTLE_BAND = 0.25
const SETTLE_HOLD_MS = 30e3
const HERD_WINDOW_MS = 30e3
const REVERSAL_MIN = 3
const CHURN_WINDOW_MIN = 3
const SHOCK_WATCH_MIN = 15

interface Switch {
  at: number
  from: TaskName
  to: TaskName
}

export class AllocationMetrics {
  readonly tasks = {} as Record<TaskName, TaskMetrics>
  churn = 0
  reversals = 0
  /** Decisions taken, and how many of them had a wide enough sample (DECISION_SAMPLE_SHARE). */
  decisions = 0
  decisionsCovered = 0
  tasksMetMean = 0
  shock: ShockRecord | null = null
  /** Minutes sampled. */
  minutes = 0

  private acc = {} as Record<TaskName, { under: number; error: number; time: number; bias: number; biasTime: number }>
  private recent: Switch[] = []
  private lastSwitch = new WeakMap<Ant, Switch>()
  private reversed = 0
  private churnAcc = 0
  private settleSince: number | null = null

  constructor() {
    TASK_ORDER.forEach((t) => {
      this.tasks[t] = { supply: 1, underShare: 0, trackingError: 0, perceived: 0, trueShare: 0, bias: 1, biasMean: 1, switchesIn: 0, switchesOut: 0 }
      this.acc[t] = { under: 0, error: 0, time: 0, bias: 0, biasTime: 0 }
    })
  }

  /** An ant came to decide (whether or not it then switched). */
  decided(covered: boolean, tasksMet: number): void {
    this.decisions++
    if (covered) this.decisionsCovered++
    this.tasksMetMean += (tasksMet - this.tasksMetMean) / Math.min(this.decisions, 500)
  }

  get sampleShare(): number {
    return this.decisions > 0 ? this.decisionsCovered / this.decisions : 0
  }

  /** An ant changed task (called by the colony from the ant's switch hook). */
  switched(ant: Ant, from: TaskName, to: TaskName, now: number): void {
    if (from === to) return
    this.tasks[from].switchesOut++
    this.tasks[to].switchesIn++
    const previous = this.lastSwitch.get(ant)
    if (previous && previous.to === from && to === previous.from && now - previous.at < REVERSAL_MIN * 60e3) this.reversed++
    const s = { at: now, from, to }
    this.lastSwitch.set(ant, s)
    this.recent.push(s)
    this.churnAcc++
  }

  /** Once per economy tick. */
  sample(now: number, dtMin: number, ants: Ant[], needs: NestNeeds): void {
    this.minutes += dtMin
    const awake = ants.filter((a) => !a.isSleeping)
    const onTask = {} as Record<TaskName, Ant[]>
    TASK_ORDER.forEach((t) => (onTask[t] = []))
    awake.forEach((a) => onTask[a.data.behaviour.actualTask.type].push(a))

    TASK_ORDER.forEach((t) => {
      const m = this.tasks[t]
      const { need, actual } = needs[t]
      const supply = need > 0 ? actual / need : 2
      m.supply = supply
      const acc = this.acc[t]
      acc.time += dtMin
      if (supply < 0.5) acc.under += dtMin
      const ratio = need > 0 && actual > 0 ? need / actual : need > 0 ? 8 : 1
      acc.error += Math.abs(Math.log2(ratio)) * dtMin
      m.underShare = acc.time > 0 ? acc.under / acc.time : 0
      m.trackingError = acc.time > 0 ? acc.error / acc.time : 0
      const crew = onTask[t]
      m.trueShare = awake.length > 0 ? crew.length / awake.length : 0
      m.perceived = crew.length > 0 ? crew.reduce((sum, a) => sum + a.encounterShare(t), 0) / crew.length : 0
      m.bias = m.trueShare > 0 && crew.length > 0 ? m.perceived / m.trueShare : 1
      if (crew.length > 0) {
        acc.bias += m.bias * dtMin
        acc.biasTime += dtMin
        m.biasMean = acc.bias / acc.biasTime
      }
    })

    // Churn and reversals over a sliding window.
    const cutoff = now - CHURN_WINDOW_MIN * 60e3
    while (this.recent.length && this.recent[0].at < cutoff) this.recent.shift()
    this.churn = awake.length > 0 ? this.recent.length / CHURN_WINDOW_MIN / awake.length : 0
    const total = TASK_ORDER.reduce((s, t) => s + this.tasks[t].switchesIn, 0)
    this.reversals = total > 0 ? this.reversed / total : 0

    // Shock follow-up.
    const sh = this.shock
    if (sh && sh.elapsedMin < SHOCK_WATCH_MIN) {
      sh.elapsedMin = (now - sh.at) / 60e3
      const supply = this.tasks[sh.task].supply
      sh.overshoot = Math.max(sh.overshoot, supply - 1)
      const joined = this.recent.filter((s) => s.to === sh.task && s.at >= now - HERD_WINDOW_MS && s.at >= sh.at).length
      sh.herd = Math.max(sh.herd, joined)
      if (sh.responseMin === null) {
        if (Math.abs(supply - 1) <= SETTLE_BAND) {
          if (this.settleSince === null) this.settleSince = now
          if (now - this.settleSince >= SETTLE_HOLD_MS) sh.responseMin = (this.settleSince - sh.at) / 60e3
        } else {
          this.settleSince = null
        }
      }
    }
  }

  /** The colony applied a shock: start watching the hit task. */
  startShock(kind: ShockKind, now: number, crewBefore: number, supplyBefore: number): void {
    this.shock = { kind, task: SHOCK_TASK[kind], at: now, crewBefore, supplyBefore, responseMin: null, overshoot: 0, herd: 0, elapsedMin: 0 }
    this.settleSince = null
  }
}
