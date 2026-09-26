import { Engine } from '@babylonjs/core'

import { Create as CreateScene01 } from './scenes/scene01'
import './assets/css/main.css'

const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement | null
if (!canvas) throw new Error('renderCanvas not found in DOM')

// Stencil on: the task highlight (HighlightLayer) needs it.
const engine = new Engine(canvas, true, { stencil: true })

window.addEventListener('resize', () => engine.resize())

const scene = CreateScene01(engine)

engine.runRenderLoop(() => scene.render())
