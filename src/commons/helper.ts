import {
  Animation,
  ArcRotateCamera,
  Color3,
  Engine,
  HemisphericLight,
  Scene,
  StandardMaterial,
  Vector3,
} from '@babylonjs/core'
import { AdvancedDynamicTexture, Button, Control, Rectangle, StackPanel, TextBlock } from '@babylonjs/gui'

// TextWrapping is a const enum in @babylonjs/gui; isolatedModules forbids cross-module
// const enum access. WordWrap = 1 in the GUI source.
const TEXT_WRAP_WORDWRAP = 1

import { SYMBOL_SCALE, WORLD_SCALE } from '../constants'

export const TITLE_FONT_SIZE = 32
export const SUB_TITLE_FONT_SIZE = 24
export const HEADER_FONT_SIZE = 16
export const SUB_HEADER_FONT_SIZE = 14
export const FONT_SIZE = 12
export const BOLD_FONT = 500
export const NORMAL_FONT = 400
export const THIN_FONT = 100

export const isEven = (value: number): boolean => value % 2 === 0

export interface Margins {
  t?: number | string
  b?: number | string
  r?: number | string
  l?: number | string
}

export interface Alignment {
  v: number
  h: number
}

export const getTextBox = (
  id: string,
  text: string,
  color: string,
  fontWeight: number,
  fontSize: number | string,
  margins: Margins,
  alignment: Alignment | null,
  resize: boolean,
): TextBlock => {
  const textBox = new TextBlock(id)
  textBox.textWrapping = TEXT_WRAP_WORDWRAP
  textBox.fontFamily = 'Roboto'
  textBox.fontWeight = String(fontWeight)
  textBox.fontSize = fontSize
  textBox.color = color
  textBox.text = text
  textBox.lineSpacing = typeof fontSize === 'number' ? `${fontSize}px` : fontSize
  if (resize) textBox.resizeToFit = true
  if (margins.t !== undefined) textBox.paddingTop = margins.t
  if (margins.b !== undefined) textBox.paddingBottom = margins.b
  if (margins.r !== undefined) textBox.paddingRight = margins.r
  if (margins.l !== undefined) textBox.paddingLeft = margins.l
  if (alignment) {
    textBox.textVerticalAlignment = alignment.v
    textBox.textHorizontalAlignment = alignment.h
  }
  return textBox
}

export const getNewScene = (engine: Engine): Scene => {
  const scene = new Scene(engine)
  scene.collisionsEnabled = true
  scene.clearColor = Color3.Black().toColor4(1)
  return scene
}

export const getNewCamera = (id: string, scene: Scene, canvas: HTMLCanvasElement, space_size: number): ArcRotateCamera => {
  const camera = new ArcRotateCamera(id, 1.5, 1.55, space_size * 10, Vector3.Zero(), scene, true)
  camera.collisionRadius = new Vector3(1, 1, 1)
  camera.lowerRadiusLimit = 10 * SYMBOL_SCALE
  camera.upperRadiusLimit = WORLD_SCALE * 1.8
  camera.radius = 30
  camera.wheelPrecision = 1
  camera.attachControl(canvas, true)
  return camera
}

export const getNewLight = (id: string, scene: Scene): HemisphericLight => {
  const light = new HemisphericLight(id, new Vector3(-1, 1, 0), scene)
  light.intensity = 1
  return light
}

export const getAnimationSphere = (): Animation => {
  const scaleAnimation = new Animation(
    'scaleAnimation',
    'scaling',
    30,
    Animation.ANIMATIONTYPE_VECTOR3,
    Animation.ANIMATIONLOOPMODE_CYCLE,
  )
  scaleAnimation.setKeys([
    { frame: 0, value: new Vector3(1, 1, 1) },
    { frame: 5, value: new Vector3(1.2, 1, 1.2) },
    { frame: 10, value: new Vector3(0.8, 1, 0.8) },
    { frame: 15, value: new Vector3(1, 1, 1) },
  ])
  return scaleAnimation
}

export const createLabel = (
  advancedTexture: AdvancedDynamicTexture,
  mesh: { name: string },
  customText?: string,
): Rectangle => {
  const label = new Rectangle('label for ' + mesh.name)
  const text = new TextBlock()
  const style = advancedTexture.createStyle()
  const textToDisplay = customText ?? mesh.name

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
  // mesh is a Babylon AbstractMesh in real usage — narrow type kept loose to avoid
  // forcing the import here when this helper is purely a UI sidecar
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  label.linkWithMesh(mesh as any)

  text.text = textToDisplay
  text.alpha = 1
  text.color = '#fff'
  text.style = style
  label.addControl(text)

  return label
}

export const createSimpleBtn = (id: string, text: string): Button => {
  const btn = Button.CreateSimpleButton(id, text)
  btn.zIndex = 40
  btn.color = 'black'
  btn.fontFamily = 'Roboto'
  btn.fontWeight = String(THIN_FONT)
  btn.fontSize = SUB_TITLE_FONT_SIZE
  btn.heightInPixels = 60
  btn.thickness = 0
  return btn
}

export interface PanelPosition {
  horizontalAlignment?: number
  verticalAlignment?: number
}

export const createSimplePanel = (position: PanelPosition, bgColor?: string): StackPanel => {
  const Panel = new StackPanel('mainStackPanel')
  Panel.zIndex = 1000
  Panel.height = '100%'
  Panel.width = '250px'
  Panel.background = bgColor ?? 'white'
  Panel.fontFamily = 'Roboto'
  Panel.horizontalAlignment = position.horizontalAlignment ?? Control.HORIZONTAL_ALIGNMENT_LEFT
  Panel.verticalAlignment = position.verticalAlignment ?? Control.VERTICAL_ALIGNMENT_TOP
  return Panel
}
