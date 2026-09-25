import {
  AUTODISCOVERING,
  EXPLORATION_COVERAGE,
  POPULATION_CAP,
  POS_DISCOVERED_TARGET_MATCH,
  SWITCH_MODEL,
} from '../constants'
import '../assets/css/hud.css'

// Collapsible explainer panel, same look as the Anthill HUD. Static, trusted content only
// (no model data is injected as HTML), so innerHTML is used for the light markup.

const COLLAPSE_KEY = 'ant-sim:about-collapsed'
const OPEN_SECTION_KEY = 'ant-sim:about-open-section'
const REPO_URL = 'https://github.com/marcosomma/ant-sim'

interface Section {
  id: string
  title: string
  body: string
}

const pct = (n: number): string => `${Math.round(n * 100)}%`

const SECTIONS: Section[] = [
  {
    id: 'scene',
    title: 'Reading the 3D scene',
    body: `<ul>
      <li><b>Nest</b>: the dome at the centre. The <b>sleep chamber</b> sits below it, joined by a tunnel.</li>
      <li><b>Task sites</b>: each task has its own shape on a base in its colour: a <b>palisade</b> (protection),
        a <b>beacon</b> (exploration), the <b>queen's chamber</b>, a cluster of <b>eggs</b> (brood care), a
        <b>silo</b> (store), <b>soil heaps</b> (expansion) and a stack of <b>swept stones</b> (cleaning).
        One rule for all of them: the fuller or taller the shape, the better the task is supplied
        (actual ÷ need). A shape that <i>breathes</i> is badly under-served.</li>
      ${AUTODISCOVERING ? '<li><b>Faded sites</b> are undiscovered: they exist, but no ant knows the way yet, so there is no road.</li>' : ''}
      <li><b>Roads</b> run from the nest to each known site. Thicker and brighter means more ants on that task.</li>
      <li><b>Ants</b> take their task's colour. A white glow means the ant knows every site, and dimmed ants are asleep.</li>
      <li><b>Rings</b> from the nest: work delivered (in that task's colour) or a birth (white).
        <b>White spark</b>: two ants met and one taught the other where a site is. <b>Grey spark</b>: a death.</li>
      <li><b>Small rings</b> (only while a task is pinned): an encounter between one of its ants and another
        ant, coloured by the other ant's task.</li>
      <li>The <b>dashed circle</b> is the colony's foraging territory, where food spots appear. Digging
        (expansion) widens it: the easy food nearby gets used up, so new food turns up further out. The
        <b>Nest expansion</b> bar measures the same thing.</li>
      <li><b>Food</b> lies in several <b>spots</b> (mounds, sized by what is left), each with its own road.
        More spots appear as digging widens the foraging area. An emptied spot reappears elsewhere.</li>
    </ul>`,
  },
  {
    id: 'panel',
    title: 'Reading the Anthill panel',
    body: `<ul>
      <li><b>Population</b> against a performance cap of ${POPULATION_CAP}. The real limit is food.</li>
      <li><b>Born / min</b> vs <b>Died / min</b> (3-minute averages) share one scale, so the longer bar tells you
        whether the colony is growing or shrinking. Hover for causes of death.</li>
      <li><b>Generation</b>: one mean lifespan of sim time. "alive: 3–6" means four generations overlap in the nest.</li>
      <li><b>Food reserve</b>: minutes the store would last at current consumption. <b>Egg laying</b>: the queen's
        rate, and whether food or care is holding her back.</li>
      <li><b>Workforce allocation</b>: the colony split by task. The grey hatched segment is asleep.</li>
      <li>Each task row: <b>workforce</b> (solid = awake, faded = asleep); the <b>demand</b> bar (need ÷ actual on a
        log scale, centre = balanced, right = under-served); an <b>underline</b> for the share of ants that know
        the site. Hover a row to highlight that task in 3D and see raw values.</li>
    </ul>`,
  },
  {
    id: 'decide',
    title: 'How an ant chooses its work',
    body:
      SWITCH_MODEL === 'threshold'
        ? `<p>No ant is told what to do. Each time it comes home it reports the work it did and reconsiders:</p>
      <ol>
        <li><b>How urgent is each task?</b> Urgency = need ÷ actual, over <i>recent</i> activity (both decay),
          so the colony keeps reacting instead of averaging its whole history.</li>
        <li><b>How crowded does each task look?</b> The ant keeps a fading tally of whom it has met, by task.
          A task it keeps bumping into feels well staffed. This is Gordon's key point: ants read
          the <i>rate of encounters</i>, not a global count.</li>
        <li><b>Switch or stay?</b> It picks the task that looks most pressing and switches with probability
          s² / (s² + θ²), where s is how much more pressing that task looks and θ is the ant's own threshold,
          inherited from its genetic priorities. Only some ants move on any visit, so the colony doesn't
          stampede.</li>
        <li>An ant never leaves a task below its minimum crew.</li>
      </ol>
      <p>Finishing one job creates others: collected food needs storing, digging makes spoil to clean,
        and so on. That is what keeps the eight tasks coupled.</p>`
        : `<p>Legacy 2021 rule: each ant ranks tasks by genetic priority × urgency and switches when another task
        is more urgent than its own. Every ant sees the same urgencies, so the colony tends to move as one.</p>`,
  },
  {
    id: 'discover',
    title: 'Finding places and sharing what they know',
    body: `<ul>
      ${
        AUTODISCOVERING
          ? `<li>Ants are born knowing no site. An ant without a known site wanders to random points and
        notices its task's site whenever it passes within ${POS_DISCOVERED_TARGET_MATCH} units of it.</li>
      <li>The exploration range grows with the sites, keeping the farthest one within
        ${pct(EXPLORATION_COVERAGE)} of it, so no site is ever out of reach.</li>`
          : '<li>Ants are born knowing where every site is.</li>'
      }
      <li>When two ants meet, each can teach the other where its own task's site is. Knowledge spreads through
        the colony by encounters, with no map and no leader.</li>
      <li>Collectors remember <b>one food spot</b> each and pass it on to collectors they meet. When a spot is
        emptied, nobody is told: its users walk to the old place, find nothing, and have to search again. The
        rest of the colony keeps foraging its own spots.</li>
    </ul>`,
  },
  {
    id: 'life',
    title: 'Food, the queen, life and death',
    body: `<ul>
      <li><b>Food in</b>: collectors bring food home, less per trip the more of them share the site.
        <b>Food out</b>: every ant eats (big ants twice as much), and the store spoils unless Store work keeps up.
        A thin reserve raises the need to collect.</li>
      <li><b>Births</b>: only the queen lays. Her rate follows the food reserve and how well she is cared for,
        and every egg costs food.</li>
      <li><b>Deaths</b>: each ant has its own lifespan (0.6–1.4× the mean). Work outside the nest (collection,
        exploration, protection, cleaning, expansion) adds risk, so foragers die younger. An empty store
        starves ants.</li>
      <li><b>Sleep</b>: ants take short naps in the chamber under the nest, and meet no one while asleep.</li>
      <li>So the <b>population is not a setting</b>. It settles wherever food income, the queen and mortality
        balance out.</li>
    </ul>`,
  },
  {
    id: 'controls',
    title: 'Controls',
    body: `<ul>
      <li>Speed slider: pause to 16×. <kbd>Space</kbd> pauses, <kbd>[</kbd> <kbd>]</kbd> step slower / faster.
        Everything (timers, lifespans, movement) follows the same clock.</li>
      <li>Drag to orbit, scroll to zoom. Click a site's base to fly to it, and <kbd>H</kbd> returns to the nest.</li>
      <li>Hover a task in the Anthill panel to preview it in 3D. <b>Click</b> it to pin it: its ants stay
        singled out and every encounter they have flashes as a small ring, in the colour of the ant they met.
        That is the raw signal each ant uses to judge how busy each job is. Click again (or <kbd>Esc</kbd>) to
        release.</li>
    </ul>`,
  },
  {
    id: 'caveats',
    title: 'What this is, and is not',
    body: `<ul>
      <li>This is a model of <b>distributed task allocation</b> after D. M. Gordon's <i>Ant Encounters</i>, not an
        ant-colony-optimisation (pheromone trail) simulator.</li>
      <li>Time is compressed and the parameters are illustrative, not fitted to a species. Read it for
        <i>patterns</i>: division of labour, recovery, boom and bust. The numbers are not predictions.</li>
      <li>Known open issues: the queen reacts to the food <i>stock</i>, not its trend, so a young colony
        overshoots before settling. A few 2021 quirks are kept on purpose and documented in the code.</li>
      <li>Long runs without a browser: <code>pnpm sim:headless 120 16</code>.</li>
    </ul>`,
  },
]

const readFlag = (key: string): string | null => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const writeFlag = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* storage unavailable: state just won't persist */
  }
}

export const createAbout = (): void => {
  const root = document.createElement('aside')
  root.className = 'hud about'
  root.setAttribute('aria-label', 'About this simulation')

  // Open by default on wide screens, where it doesn't cover the colony; remembered after that.
  const stored = readFlag(COLLAPSE_KEY)
  const collapsed = stored === null ? window.matchMedia('(max-width: 900px)').matches : stored === '1'
  if (collapsed) root.classList.add('is-collapsed')

  const header = document.createElement('header')
  header.className = 'hud-header'
  const title = document.createElement('h1')
  title.className = 'hud-title'
  title.textContent = 'About'
  const toggle = document.createElement('button')
  toggle.className = 'hud-toggle'
  toggle.type = 'button'
  toggle.setAttribute('aria-label', 'Toggle explanation')
  toggle.setAttribute('aria-expanded', String(!collapsed))
  toggle.onclick = () => {
    const nowCollapsed = root.classList.toggle('is-collapsed')
    toggle.setAttribute('aria-expanded', String(!nowCollapsed))
    writeFlag(COLLAPSE_KEY, nowCollapsed ? '1' : '0')
  }
  header.append(title, toggle)

  const body = document.createElement('div')
  body.className = 'hud-body about-body'

  const intro = document.createElement('p')
  intro.className = 'about-intro'
  intro.innerHTML = `An anthill where <b>no ant is in charge</b>. Every ant follows a few local rules: what it
    senses about the nest's needs, and whom it bumps into. The colony's division of labour, its size and
    whether it survives all <i>emerge</i> from those rules. Inspired by D. M. Gordon's
    <i>Ant Encounters</i> and complex adaptive systems.`
  body.append(intro)

  // One section open at a time keeps the panel short; the last one opened is remembered.
  const openId = readFlag(OPEN_SECTION_KEY) ?? 'scene'
  const details: HTMLDetailsElement[] = []
  SECTIONS.forEach((section) => {
    const d = document.createElement('details')
    d.className = 'about-section'
    d.open = section.id === openId
    const summary = document.createElement('summary')
    summary.textContent = section.title
    const content = document.createElement('div')
    content.className = 'about-content'
    content.innerHTML = section.body
    d.append(summary, content)
    d.addEventListener('toggle', () => {
      if (!d.open) return
      details.forEach((other) => other !== d && (other.open = false))
      writeFlag(OPEN_SECTION_KEY, section.id)
    })
    details.push(d)
    body.append(d)
  })

  const footer = document.createElement('p')
  footer.className = 'hud-note about-footer'
  footer.innerHTML = `Hand-written in 2021, modernised in 2026 · <a href="${REPO_URL}" target="_blank" rel="noopener">source on GitHub</a>`
  body.append(footer)

  root.append(header, body)
  document.body.append(root)
}
