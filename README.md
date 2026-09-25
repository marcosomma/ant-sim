# ant-sim

**▶ Live: [marcosomma.github.io/ant-sim](https://marcosomma.github.io/ant-sim/)**. Runs in the browser, nothing to install. Open the **About** panel in the app for a guided explanation.

Anthill simulator inspired by D.M. Gordon's _Ant Encounters: Interaction Networks and Colony Behavior_ and Complex Adaptive Systems theory.

This is **not** an ant colony optimization / pheromone-trail simulator. It models Gordon-style **distributed task allocation**. No ant is in charge: each one reads how urgent the nest's needs are and, from whom it keeps bumping into, how crowded each task already is. It then switches work by its own response threshold. Division of labour, the colony's size and whether it survives all emerge from those local rules plus a food economy (see [Task switching](#task-switching) and [Colony economy](#colony-economy-dynamic-population)).

Originally hand-written in 2021. Modernized in 2026 to Vite + TypeScript + Babylon.js 8. The original switching rule is kept as `SWITCH_MODEL = 'legacy'` for comparison.

## Stack

- Node 22, pnpm 9
- Vite 6, TypeScript 5
- `@babylonjs/core` / `@babylonjs/gui` 8.x

## Development

```sh
pnpm install
pnpm dev
```

Then open <http://localhost:8080>.

## Headless runs

```sh
pnpm sim:headless 120 16   # 120 simulated minutes at 16×, one line per minute
```

Same model code as the browser (`src/model/colony.ts`), rendered with Babylon's `NullEngine` on a fake clock, so two hours of colony life take well under a minute. Use it to tune the economy constants.

## Production build

```sh
pnpm build
pnpm preview
```

## Docker

Production-style nginx serve:

```sh
docker compose up --build
# → http://localhost:8080
```

Dev mode with hot reload:

```sh
docker compose --profile dev up ant-sim-dev
# → http://localhost:8081
```

## Layout

```
src/
  main.ts              # Vite entry — creates engine, loads scene
  constants.ts         # All tunable factors + types
  classes/ant.ts       # Ant class — per-tick logic, encounters, task switching
  commons/helper.ts    # Babylon scene/camera/light/GUI helpers
  commons/meshCreator.ts # Ant sphere mesh
scripts/headless.ts    # Headless run for tuning (pnpm sim:headless)
  commons/simClock.ts  # Simulation clock (speed / pause)
  model/colony.ts      # Colony model: nest needs, food, queen, births/deaths (no DOM)
  scenes/scene01.ts    # Wiring: scene, clock, colony, view, HUD
  scenes/colonyView.ts # 3D layer: nest + sleep chamber, task tanks, roads, event effects
  ui/hud.ts            # DOM overlay: colony stats, allocation, per-task bars, speed control
  ui/palette.ts        # Fixed task → colour mapping shared by 3D scene and HUD
  assets/              # Roboto fonts + CSS (Vite-bundled)
```

## Colony economy (dynamic population)

Population is no longer a fixed number. Collect deliveries bring food home (less per trip the more collectors share the patch: `FORAGING_PATCH`), food spoils unless Store work keeps up, and every ant eats (`FOOD_PER_ANT_PER_MIN`). Only the queen lays: her rate scales with the food reserve and with how well Queen care is supplied. An empty store starves ants. With `HUNGER_FEEDBACK` on, a thin reserve raises Collect need, pulling ants into foraging.

The carrying capacity emerges from that loop. Headless runs, 150–180 sim minutes: a patch of 40 settles around 380–395 ants on a 10–13 min reserve, a patch of 20 overshoots to ~280 and settles around 220 on ~3 min. `POPULATION_CAP` (500) is only a performance ceiling.

A generation is one mean lifespan of sim time (≈ 22.5 × `CHECK_TIME_INTERVAL`), so the HUD's "alive: 3–7" shows how many overlapping generations are in the nest.

## Task switching

`SWITCH_MODEL = 'threshold'` (default). Each ant keeps a fading tally of whom it meets, by task, and discounts a task's urgency by how crowded it looks from there (Gordon: encounter rate as a local staffing signal). It then switches with probability s² / (s² + θ²) (Bonabeau response threshold), where θ is its own threshold for the candidate task, set from `geneticalPriority` with individual jitter. The old rule compared the same global urgencies for every ant, so the whole colony stampeded onto whichever task was most urgent. `'legacy'` keeps it for comparison.

Headless, four 4-hour runs: the largest task averages ~22% of the colony (legacy: 55–95%), and every run ends alive at 222–261 ants.

## Lifespan

Intrinsic lifespan is `LIFESPAN_MEAN_MS` × [0.6, 1.4] (was uniform from ~0). Awake ants on exterior tasks (`EXTERIOR_TASKS`: food collection, exploration, protection, cleaning, expansion) carry an extra `EXTERIOR_HAZARD_PER_MIN`, so foragers die younger, as in real colonies.

## Model knobs (`src/constants.ts`)

- `WORLD_SCALE` — world size (was `MAX_ANTS`, which also doubled as the population size)
- `INITIAL_ANTS`, `POPULATION_CAP` — founding colony and hard ceiling
- `REPRODUCTION_ON` — toggles birth/death cycle (currently `false`)
- `AUTODISCOVERING` — when on, ants must visually find task locations rather than knowing them at birth
- `ANT_INFLUENCE_FACTOR` — magnitude of encounter-based rank updates. Currently sampled as `Math.random() / 1e6`, so encounters are effectively negligible vs. urgency-driven updates. See open question in the project notes.
- `INCREASE_MAIN_TASK` — feedback weight when an ant reports completion to the nest
- `CHECK_TIME_INTERVAL`, `MIN_CHECK_TIME_INTERVAL` — ant decision cadence
- `SEARCHING_RADIUS` — world scale

## Notes

- No physics engine. Encounters are bounding-box intersections (`intersectsMesh` in `registerCollider`). The old cannon impostors added nothing to the model and gave overlapping ants contact velocities that carried any non-animated ant away from the nest.
- All model timing goes through `src/commons/simClock.ts` (`simNow`, `simSetInterval`), so the HUD speed slider (0–16×, Space to pause, `[` `]` to step) scales timers, lifetimes and Babylon animations together.
- `TASK_POSITIONS`, `SLEEP_POSITION`, `ANT_INFLUENCE_FACTOR`, and `CHECK_TIME_INTERVAL` are sampled at module load — random per process, but stable for the duration of a run.
