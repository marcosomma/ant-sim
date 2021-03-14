import * as BABYLON from 'babylonjs'
import { Create as CreateScene01, registerEventListener as registerEventListenerScene01 } from './scenes/scene01'
import { Create as CreateScene02, registerEventListener as registerEventListenerScene02 } from './scenes/scene02'
const canvas = document.getElementById('renderCanvas')
const engine = new BABYLON.Engine(canvas)
const changeRoot = (newRoot) => (root = newRoot)
let root = 'scene01'
let oldRoot = undefined

//Babylonjs requirements
window.CANNON = require('cannon')
window['BABYLON'] = BABYLON
//

const renderScene = () => {
  let scene
  try {
    // Start render loop
    engine.runRenderLoop(() => {
      if (oldRoot !== root) {
        switch (root) {
          case 'scene02':
            scene = CreateScene02(engine, changeRoot)
            registerEventListenerScene02()
            break
          default:
            scene = CreateScene01(engine, changeRoot)
            registerEventListenerScene01()
            break
        }
        oldRoot = root
      }
      scene.render()
    })

    // Babylonjs trigger resize event
    window.addEventListener('resize', function () {
      engine.resize()
    })
  } catch (error) {
    console.error(error)
  }
}

renderScene()
