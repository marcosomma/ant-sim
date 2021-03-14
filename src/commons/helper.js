import * as BABYLON from 'babylonjs'
import * as GUI from 'babylonjs-gui'

export const TITLE_FONT_SIZE = '32px'
export const SUB_TITLE_FONT_SIZE = '24px'
export const HEADER_FONT_SIZE = '16px'
export const SUB_HEADER_FONT_SIZE = '14px'
export const FONT_SIZE = '12px'
export const BOLD_FONT = 500
export const NORMAL_FONT = 400
export const THINY_FONT = 100

export const getTextBox = (id, text, color, fontWeight, fontSize, margins, alignment, resize) => {
  let textBox = new GUI.TextBlock(id)
  textBox.textWrapping = GUI.TextWrapping.WordWrap
  textBox.fontFamily = 'Roboto'
  textBox.fontWeight = fontWeight
  textBox.fontSize = fontSize
  textBox.color = color
  textBox.text = text
  textBox.lineWidth = fontSize
  if (resize) textBox.resizeToFit = true
  if (margins.t) textBox.paddingTop = margins.t
  if (margins.b) textBox.paddingBottom = margins.b
  if (margins.r) textBox.paddingRight = margins.r
  if (margins.l) textBox.paddingLeft = margins.l
  if (alignment) {
    textBox.textVerticalAlignment = alignment.v
    textBox.textHorizontalAlignment = alignment.h
  }
  return textBox
}

export const getNewScene = (engine) => {
  let scene = new BABYLON.Scene(engine)
  scene.clearColor = new BABYLON.Color3(1, 1, 1)
  scene.ambientColor = new BABYLON.Color3(1, 1, 1)
  scene.enablePhysics(new BABYLON.Vector3(0, 0, 0), new BABYLON.CannonJSPlugin())
  scene.collisionsEnabled = true
  scene.exclusiveDoubleMode = false

  return scene
}

export const getNewCamera = (id, scene, canvas, space_size) => {
  let camera = new BABYLON.ArcRotateCamera(id, 1, 1, space_size * 10, new BABYLON.Vector3.Zero(), scene, true)
  camera.attachControl(canvas, true)
  camera.collisionRadius = new BABYLON.Vector3(1, 1, 1)
  camera.lowerRadiusLimit = 10
  camera.upperRadiusLimit = 200
  camera.wheelPrecision = 1

  return camera
}

export const getNewLight = (id, scene) => {
  var light = new BABYLON.HemisphericLight(id, new BABYLON.Vector3(-1, 1, 0), scene)
  light.diffuse = new BABYLON.Color3.White()
  light.specular = new BABYLON.Color3.White()
  light.intensity = 1
  return light
}

export const getAnimationSphere = () => {
  var scaleAnimation = new BABYLON.Animation(
    'scaleAnimation',
    'scaling',
    30,
    BABYLON.Animation.ANIMATIONTYPE_VECTOR3,
    BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE
  )
  var keys = [
    {
      frame: 0,
      value: new BABYLON.Vector3(1, 1, 1),
    },
    {
      frame: 5,
      value: new BABYLON.Vector3(1.2, 1.2, 1.2),
    },
    {
      frame: 10,
      value: new BABYLON.Vector3(0.5, 0.5, 0.5),
    },
    {
      frame: 15,
      value: new BABYLON.Vector3(1, 1, 1),
    },
  ]

  scaleAnimation.setKeys(keys)

  return scaleAnimation
}

export const createLabel = (advancedTexture, mesh, customText) => {
  let label = new GUI.Rectangle('label for ' + mesh.name)
  let text = new GUI.TextBlock()
  let style = advancedTexture.createStyle()
  let textToDisplay = customText || mesh.name

  style.fontSize = 14
  style.fontWeight = 'bold'
  style.fontFamily = 'Roboto'

  label.background = 'transparent'
  label.height = '15px'

  label.alpha = 1
  label.width = `${textToDisplay.length * 15}px`
  label.cornerRadius = 10
  label.thickness = 0
  advancedTexture.addControl(label)
  label.linkWithMesh(mesh)

  text.text = textToDisplay
  text.alpha = 1
  text.color = '#00f'
  text.style = style
  label.addControl(text)

  return label
}

export const createSimpleBtn = (id, text) => {
  let SimpleBtn = new GUI.Button.CreateSimpleButton(id, text)
  SimpleBtn.zIndex = 40
  SimpleBtn.color = 'black'
  SimpleBtn.fontFamily = 'Roboto'
  SimpleBtn.fontWeight = THINY_FONT
  SimpleBtn.fontSize = SUB_TITLE_FONT_SIZE
  SimpleBtn.heightInPixels = 60
  SimpleBtn.thickness = 0

  return SimpleBtn
}

export const createSimplePanel = (position, bgColor) => {
  let Panel = new GUI.StackPanel('mainStackPanel')
  Panel.zIndex = 1000
  Panel.height = '60px'
  Panel.width = '200px'
  Panel.background = bgColor || 'white'
  Panel.fontFamily = 'Roboto'
  Panel.horizontalAlignment = position.horizontalAlignment || GUI.Control.HORIZONTAL_ALIGNMENT_LEFT
  Panel.verticalAlignment = position.verticalAlignment || GUI.Control.VERTICAL_ALIGNMENT_TOP
  Panel.thickness = 0

  return Panel
}
