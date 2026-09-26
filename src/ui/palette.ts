import { Color3 } from '@babylonjs/core/Maths/math.color'

import { TaskName } from '../constants'

// Fixed task order = fixed colour slot. Colour follows the task, never its rank,
// so the 3D task boxes, the ants and the HUD all agree.
// Validated (dark surface, adjacent pairs): CVD ΔE >= 8.4, normal-vision ΔE >= 19.3, >= 3:1 contrast.
export const TASK_ORDER: TaskName[] = [
  'Protection',
  'Exploration',
  'QueenCare',
  'EggLarvePupeaCare',
  'Collect',
  'Store',
  'Expansion',
  'Cleaning',
]

export const TASK_HEX: Record<TaskName, string> = {
  Protection: '#3987e5',
  Exploration: '#d95926',
  QueenCare: '#199e70',
  EggLarvePupeaCare: '#c98500',
  Collect: '#d55181',
  Store: '#008300',
  Expansion: '#9085e9',
  Cleaning: '#e66767',
}

export const TASK_LABEL: Record<TaskName, string> = {
  Protection: 'Protection',
  Exploration: 'Exploration',
  QueenCare: 'Queen care',
  EggLarvePupeaCare: 'Brood care',
  Collect: 'Food collection',
  Store: 'Store',
  Expansion: 'Expansion',
  Cleaning: 'Cleaning',
}

export const TASK_COLOR3: Record<TaskName, Color3> = Object.fromEntries(
  TASK_ORDER.map((t) => [t, Color3.FromHexString(TASK_HEX[t])]),
) as Record<TaskName, Color3>

/**
 * What the Anthill panel can single out: a task, or sleep. Sleep is not a task (it is a state
 * every ant goes through) but it has its own row, measured and highlightable like the tasks,
 * in the blue of the sleeping rooms.
 */
export type Focus = TaskName | 'Sleep'
export const SLEEP_HEX = '#7380bf'
export const SLEEP_LABEL = 'Sleep'
export const FOCUS_COLOR3 = (focus: Focus): Color3 => (focus === 'Sleep' ? Color3.FromHexString(SLEEP_HEX) : TASK_COLOR3[focus])
