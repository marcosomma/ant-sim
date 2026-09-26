import { ArcRotateCamera, Color3, Matrix, Mesh, MeshBuilder, Scene, StandardMaterial, Vector3 } from '@babylonjs/core'

import type Ant from '../classes/ant'
import { isUnderground } from '../constants'
import type { Colony } from '../model/colony'
import type { ColonyView } from './colonyView'
import { SLEEP_LABEL, TASK_LABEL } from '../ui/palette'

// Moving around the anthill and looking closer, on top of the orbit camera:
//   W A S D pan the view over the ground (relative to where the camera faces, faster when
//   zoomed out), E / Q move it up / down; H recentres on the nest (ColonyView); Esc resets
//   the camera to its starting view.
//   Click an ant to FOLLOW it: the camera keeps its angle and zoom and tracks the ant, a ring
//   marks it and a pill says what it is doing; if it goes underground the view goes with it.
//   Esc, a click on empty ground, or panning releases it (so does the ant's death).
// Nothing else is clickable. Babylon's own picking stays off: the click is a ray tested
// against the ants' positions. View only: never touches the model.

/** Pan speed as a share of the camera's distance, per second. */
const PAN = 0.4
/** How close (in world units, scaled by zoom) a click must come to an ant to pick it. */
const PICK_RADIUS = 1.4

export class Navigation {
  private keys = new Set<string>()
  private following: Ant | null = null
  private ring: Mesh
  private pill: HTMLElement
  private down: { x: number; y: number } | null = null

  constructor(
    private scene: Scene,
    private camera: ArcRotateCamera,
    private canvas: HTMLCanvasElement,
    private colony: Colony,
    private view: ColonyView,
  ) {
    this.ring = MeshBuilder.CreateTorus('follow:ring', { diameter: 2.4, thickness: 0.18, tessellation: 32 }, scene)
    const mat = new StandardMaterial('follow:ring', scene)
    mat.diffuseColor = Color3.White()
    mat.emissiveColor = new Color3(0.9, 0.9, 0.9)
    mat.specularColor = Color3.Black()
    mat.disableLighting = true
    this.ring.material = mat
    this.ring.isPickable = false
    this.ring.setEnabled(false)

    this.pill = document.createElement('div')
    this.pill.className = 'follow-pill'
    this.pill.hidden = true
    document.body.append(this.pill)

    const typing = (e: KeyboardEvent): boolean => e.target instanceof HTMLInputElement && !e.target.classList.contains('hud-slider')
    window.addEventListener('keydown', (e) => {
      if (typing(e)) return
      if (e.key === 'Escape') {
        this.follow(null)
        this.view.resetCamera()
      }
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'].includes(e.code)) this.keys.add(e.code)
    })
    window.addEventListener('keyup', (e) => this.keys.delete(e.code))
    window.addEventListener('blur', () => this.keys.clear())

    // A click (not a drag) on the canvas: follow the ant under the pointer, or release.
    canvas.addEventListener('pointerdown', (e) => (this.down = { x: e.clientX, y: e.clientY }))
    canvas.addEventListener('pointerup', (e) => {
      const d = this.down
      this.down = null
      if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) return
      this.follow(this.antAt(e.clientX, e.clientY))
    })

    scene.onBeforeRenderObservable.add(() => this.update(scene.getEngine().getDeltaTime() / 1000))
    window.setInterval(() => this.paintPill(), 250)
  }

  /** The ant nearest the ray through pointer (x, y), if close enough; null otherwise. */
  private antAt(x: number, y: number): Ant | null {
    const rect = this.canvas.getBoundingClientRect()
    const ray = this.scene.createPickingRay(x - rect.left, y - rect.top, Matrix.Identity(), this.camera)
    const underground = this.view.view === 'underground' || this.view.shownView === 'underground'
    let best: Ant | null = null
    let bestD = Infinity
    this.colony.ants.forEach((ant) => {
      const p = ant.data.body?.position as Vector3 | undefined
      if (!p) return
      // Only ants the current view draws.
      if (isUnderground(p) !== underground && !underground) return
      const toP = p.subtract(ray.origin)
      const along = Vector3.Dot(toP, ray.direction)
      if (along < 0) return
      const off = toP.subtract(ray.direction.scale(along)).length()
      // Tolerance grows with distance, so a far ant is still clickable.
      const tol = PICK_RADIUS * Math.max(1, along / 60)
      if (off < tol && along < bestD) {
        bestD = along
        best = ant
      }
    })
    return best
  }

  follow(ant: Ant | null): void {
    this.following = ant
    this.ring.setEnabled(ant !== null)
    this.pill.hidden = ant === null
    this.view.hintUnderground(false)
    this.paintPill()
  }

  private paintPill(): void {
    const ant = this.following
    if (!ant) return
    const doing = ant.isSleeping ? SLEEP_LABEL.toLowerCase() : TASK_LABEL[ant.data.behaviour.actualTask.type].toLowerCase()
    const where = isUnderground(ant.data.body.position) ? 'underground' : 'on the surface'
    this.pill.textContent = `Following an ant · ${doing}, ${where} · Esc or click elsewhere to release`
  }

  private update(dt: number): void {
    if (dt <= 0) return
    const cam = this.camera
    // Pan: along the camera's facing, over the ground.
    const fwd = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0)
    const side = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0)
    const rise = (this.keys.has('KeyE') ? 1 : 0) - (this.keys.has('KeyQ') ? 1 : 0)
    if (fwd !== 0 || side !== 0 || rise !== 0) {
      if (this.following) this.follow(null) // taking the controls releases the ant
      const look = cam.target.subtract(cam.position)
      look.y = 0
      if (look.lengthSquared() < 1e-6) look.set(0, 0, 1)
      look.normalize()
      const right = new Vector3(look.z, 0, -look.x)
      const step = PAN * cam.radius * Math.min(dt, 0.1)
      const t = cam.target
      t.x += (look.x * fwd + right.x * side) * step
      t.z += (look.z * fwd + right.z * side) * step
      t.y += rise * step // down far enough and the view goes underground by itself
      cam.setTarget(t)
    }
    // Follow: track the ant, keeping angle and zoom; the view goes underground with it.
    const ant = this.following
    if (ant) {
      if (!this.colony.ants.includes(ant) || !ant.data.body) {
        this.follow(null)
        return
      }
      const p = ant.data.body.position as Vector3
      const t = cam.target
      t.x += (p.x - t.x) * 0.2
      t.y += (p.y - t.y) * 0.2
      t.z += (p.z - t.z) * 0.2
      cam.setTarget(t)
      this.ring.position.set(p.x, p.y + 0.05, p.z)
      this.ring.scaling.setAll(Math.max(0.6, cam.radius / 90))
      this.view.hintUnderground(isUnderground(p))
    }
  }
}
