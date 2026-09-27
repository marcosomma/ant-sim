// Headless colony run: same model code as the browser, no rendering, fixed time step.
//   pnpm sim:headless [minutes=60] [speed=16]
// Prints one line per simulated minute so the population dynamics can be read (or piped
// to a file and plotted) without waiting in front of a browser tab.
import './seed'
import { ArcRotateCamera, NullEngine, PrecisionDate, Scene, Vector3 } from '@babylonjs/core'

import { advance, onSpeedChange, setSpeed, simNow } from '../src/commons/simClock'
import { AllocationRuleName, CHECK_TIME_INTERVAL, allocationRuleName, setAllocationRule, FOOD_SPOT_RADIUS, MIDDEN_RADIUS, TASK_POSITIONS, clearGround, MAIN_SLEEP, TERRAIN, explorationExtent, isUnderground } from '../src/constants'
import { Colony } from '../src/model/colony'
import { SHOCK_LABEL, ShockKind } from '../src/model/metrics'
import { TASK_ORDER } from '../src/ui/palette'
import { writeFileSync } from 'node:fs'
import Ant from '../src/classes/ant'

const minutes = Number(process.argv[2] ?? 60)
const speed = Number(process.argv[3] ?? 16)
// Optional 3rd argument: food availability (e.g. 0.5 scarce, 2 abundant).
const availability = process.argv[4] !== undefined ? Number(process.argv[4]) : undefined
const FRAME_MS = 16

// The model still has debug console.log calls in hot paths; keep the output readable.
const out = (line: string): void => void process.stdout.write(line + '\n')
console.log = () => {}

// Babylon animations read PrecisionDate.Now and scale the delta by animationTimeScale.
// (useConstantAnimationDeltaTime would ignore the time scale, so fake the clock instead.)
let fakeNow = 0
Object.defineProperty(PrecisionDate, 'Now', { get: () => fakeNow, configurable: true })

const engine = new NullEngine()
const scene = new Scene(engine)
const camera = new ArcRotateCamera('headless', 0, 0, 10, Vector3.Zero(), scene)
onSpeedChange((s) => (scene.animationTimeScale = s))
setSpeed(speed)
// advance() clamps a single step to 100ms of real time; feed it per frame like the browser.
scene.onBeforeRenderObservable.add(() => advance(FRAME_MS))

// Experiment levers: ABLATION=full|board-only|encounters-only|homogeneous, SHOCK=<kind>@<minute>
// (foragers|food|brood), METRICS_CSV=<path> for a per-minute, per-task record.
if (process.env.ABLATION) setAllocationRule(process.env.ABLATION as AllocationRuleName)
const shockSpec = process.env.SHOCK?.match(/^(foragers|food|brood)@(\d+)$/)
let shockAt = shockSpec ? Number(shockSpec[2]) * 60e3 : Infinity
const csv: string[] = ['min,task,need,actual,supply,workforce,perceived,trueShare,bias,switchesIn,switchesOut,churn']
const colony = new Colony(scene, camera)
if (availability !== undefined) colony.foodAvailability = availability
colony.start()

out(`CHECK_TIME_INTERVAL=${(CHECK_TIME_INTERVAL / 1e3).toFixed(1)}s  speed=${speed}×  minutes=${minutes}  food=×${colony.foodAvailability}`)
out('min  season   alive  asleep  collect  knowC  spots known  empt  range  exp  in/m  eat/m  food   reserve  lay/m  limit  born  died  starved  gen  st/ex/bc  brood  brDied  care  exits  viaExit  wet  rooms s/b/f  mainSleep  noRoom f/b  crowd')
let nextReport = 60e3
const started = Date.now()
while (simNow() < minutes * 60e3 && colony.ants.length > 0) {
  fakeNow += FRAME_MS
  scene.render()
  if (simNow() >= shockAt) {
    shockAt = Infinity
    colony.shock(shockSpec![1] as ShockKind)
    out(`--- SHOCK at ${Math.round(simNow() / 60e3)} min: ${SHOCK_LABEL[shockSpec![1] as ShockKind]}`)
  }
  if (simNow() >= nextReport) {
    nextReport += 60e3
    if (process.env.METRICS_CSV) {
      const mm = colony.metrics
      TASK_ORDER.forEach((t) => {
        const m = mm.tasks[t]
        const n = colony.needs[t]
        const w = colony.ants.filter((a) => a.data.behaviour.actualTask.type === t && !a.isSleeping).length
        csv.push([Math.round(simNow() / 60e3), t, n.need.toFixed(3), n.actual.toFixed(3), m.supply.toFixed(3), w, m.perceived.toFixed(4), m.trueShare.toFixed(4), m.bias.toFixed(3), m.switchesIn, m.switchesOut, mm.churn.toFixed(4)].join(','))
      })
    }
    const ants = colony.ants
    const collect = ants.filter((a) => a.data.behaviour.actualTask.type === 'Collect').length
    const gen = Math.max(...ants.map((a) => a.data.generation))
    out(
      [
        String(Math.round(simNow() / 60e3)).padStart(3),
        colony.season.name.padEnd(7),
        String(ants.length).padStart(6),
        String(colony.asleep).padStart(7),
        String(collect).padStart(8),
        String(ants.filter((a) => a.data.behaviour.discoveredPositions.Collect).length).padStart(6),
        // food spots on the ground, how many are known, how many emptied so far
        String(colony.foodSpots.length).padStart(5),
        String(colony.foodSpotsKnown).padStart(6),
        String(colony.foodSitesDepleted).padStart(5),
        explorationExtent().toFixed(0).padStart(6),
        colony.expansionLevel.toFixed(2).padStart(4),
        colony.intakePerMin.toFixed(0).padStart(5),
        colony.consumptionPerMin.toFixed(0).padStart(6),
        colony.food.toFixed(0).padStart(6),
        colony.reserveMinutes.toFixed(1).padStart(8),
        colony.layRate.toFixed(1).padStart(6),
        colony.layLimit.padStart(6),
        String(colony.births).padStart(5),
        String(colony.deaths).padStart(5),
        String(colony.starved).padStart(8),
        String(gen).padStart(4),
        // workforce on Store / Expansion / brood care, brood alive, brood dead of neglect, brood care supply
        `${ants.filter((a) => a.data.behaviour.actualTask.type === 'Store').length}/${ants.filter((a) => a.data.behaviour.actualTask.type === 'Expansion').length}/${ants.filter((a) => a.data.behaviour.actualTask.type === 'EggLarvePupeaCare').length}`.padStart(10),
        String(colony.brood.length).padStart(6),
        String(colony.broodDied).padStart(7),
        colony.broodCare.toFixed(2).padStart(5),
        String(colony.exits.length).padStart(6),
        // ants on a leg that ends at an exit, and surface ants standing somewhere impassable
        String(ants.filter((a) => { const to = (a as unknown as { leg?: { to: { x: number; z: number } } }).leg?.to; return !!to && colony.exits.some((e) => Math.hypot(e.surface.x - to.x, e.surface.z - to.z) < 1) }).length).padStart(8),
        String(ants.filter((a) => { const p = a.data.body.position; return !isUnderground(p) && !TERRAIN.passable(p.x, p.z) }).length).padStart(4),
        `${['sleep', 'brood', 'store'].map((r) => colony.digNetwork.filter((n) => n.role === r).length).join('/')}`.padStart(12),
        String(MAIN_SLEEP.sleepers).padStart(10),
        `${colony.unhoused.store.toFixed(0)}/${colony.unhoused.brood.toFixed(0)}`.padStart(11),
        colony.crowding.toFixed(2).padStart(6),
      ].join(' '),
    )
  }
}
{
  const net = colony.digNetwork.slice(1)
  const R = 20
  const depth = net.map((n) => -n.pos.y / R)
  const reach = net.map((n) => Math.hypot(n.pos.x, n.pos.z) / R)
  const bad = colony.foodSpots.filter((f) => !clearGround(f.position.x, f.position.z, FOOD_SPOT_RADIUS)).length + (clearGround(TASK_POSITIONS.Cleaning.x, TASK_POSITIONS.Cleaning.z, MIDDEN_RADIUS) ? 0 : 1)
  out(`overlapping spots: ${bad}/${colony.foodSpots.length + 1}`)
  out(`stuck rescues: ${Ant.stuckRescues}  exits: ${colony.exits.length}  network: ${net.length} nodes, depth max ${Math.max(...depth).toFixed(1)}R mean ${(depth.reduce((a, b) => a + b, 0) / depth.length).toFixed(1)}R, reach max ${Math.max(...reach).toFixed(1)}R mean ${(reach.reduce((a, b) => a + b, 0) / reach.length).toFixed(1)}R`)
}
{
  const mm = colony.metrics
  out(`allocation (rule ${allocationRuleName()}): task  supply-now  under<0.5  trackErr  bias(perceived/true)  in/out`)
  TASK_ORDER.forEach((t) => {
    const m = mm.tasks[t]
    out(`  ${t.padEnd(18)} ${m.supply.toFixed(2).padStart(6)} ${(m.underShare * 100).toFixed(0).padStart(8)}% ${m.trackingError.toFixed(2).padStart(9)} ${m.biasMean.toFixed(2).padStart(10)}  ${m.switchesIn}/${m.switchesOut}`)
  })
  out(`  churn ${mm.churn.toFixed(3)} switches/ant/min  reversals ${(mm.reversals * 100).toFixed(0)}%  decisions with full sample ${(mm.sampleShare * 100).toFixed(0)}% (tasks met ${mm.tasksMetMean.toFixed(1)}/8)`)
  const sh = mm.shock
  if (sh) out(`  shock ${sh.kind} @${(sh.at / 60e3).toFixed(0)}min: crew ${sh.crewBefore}, supply ${sh.supplyBefore.toFixed(2)} -> response ${sh.responseMin === null ? 'not settled' : sh.responseMin.toFixed(1) + ' min'}, overshoot ${sh.overshoot.toFixed(2)}, herd ${sh.herd}`)
  if (process.env.METRICS_CSV) writeFileSync(process.env.METRICS_CSV, csv.join('\n') + '\n')
}
out(colony.ants.length === 0 ? 'EXTINCT' : `done in ${((Date.now() - started) / 1e3).toFixed(0)}s real time`)
process.exit(0)
