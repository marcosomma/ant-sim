import { Engine, Scene } from '@babylonjs/core'

import { advance, onSpeedChange } from '../commons/simClock'
import { getNewCamera, getNewLight, getNewScene } from '../commons/helper'
import { WORLD_SCALE } from '../constants'
import { Colony } from '../model/colony'
import { createAbout } from '../ui/about'
import { createControls } from '../ui/controls'
import { createHud } from '../ui/hud'
import { createSound } from '../ui/sound'
import { ColonyView } from './colonyView'

const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement

export const Create = (engine: Engine): Scene => {
  const scene = getNewScene(engine)
  const camera = getNewCamera('mainCamera01', scene, canvas, WORLD_SCALE)
  getNewLight('mainLight01', scene)

  // One clock for the whole sim: model timers advance on sim time, Babylon animations
  // follow the same speed. Paused (0) freezes both.
  scene.onBeforeRenderObservable.add(() => advance(engine.getDeltaTime()))
  onSpeedChange((speed) => {
    scene.animationTimeScale = speed
  })

  const colony = new Colony(scene, camera)
  const view = new ColonyView(scene, camera, colony)
  colony.events.delivered = (task) => view.delivered(task)
  colony.events.born = () => view.born()
  colony.events.died = (at) => view.died(at)
  colony.events.knowledgeShared = (at) => view.knowledgeShared(at)
  colony.events.encountered = (ant, other) => view.encountered(ant, other)
  colony.start()

  createHud({ colony, onHighlight: (task) => view.highlight(task) })
  createAbout()
  createControls(colony, createSound(colony), view)

  return scene
}
