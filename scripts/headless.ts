// Headless colony run: same model code as the browser, no rendering, fixed time step.
//   pnpm sim:headless [minutes=60] [speed=16]
// Prints one line per simulated minute so the population dynamics can be read (or piped
// to a file and plotted) without waiting in front of a browser tab.
import { ArcRotateCamera, NullEngine, PrecisionDate, Scene, Vector3 } from '@babylonjs/core'

import { advance, onSpeedChange, setSpeed, simNow } from '../src/commons/simClock'
import { CHECK_TIME_INTERVAL, explorationExtent } from '../src/constants'
import { Colony } from '../src/model/colony'

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

const colony = new Colony(scene, camera)
if (availability !== undefined) colony.foodAvailability = availability
colony.start()

out(`CHECK_TIME_INTERVAL=${(CHECK_TIME_INTERVAL / 1e3).toFixed(1)}s  speed=${speed}×  minutes=${minutes}  food=×${colony.foodAvailability}`)
out('min  season   alive  asleep  collect  knowC  spots known  empt  range  exp  in/m  eat/m  food   reserve  lay/m  limit  born  died  starved  gen')
let nextReport = 60e3
const started = Date.now()
while (simNow() < minutes * 60e3 && colony.ants.length > 0) {
  fakeNow += FRAME_MS
  scene.render()
  if (simNow() >= nextReport) {
    nextReport += 60e3
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
      ].join(' '),
    )
  }
}
out(colony.ants.length === 0 ? 'EXTINCT' : `done in ${((Date.now() - started) / 1e3).toFixed(0)}s real time`)
process.exit(0)
