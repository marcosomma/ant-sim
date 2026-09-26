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
      <li><b>Anthill</b>: the mound of dug-out soil at the centre, with its entrance on top and a disc of cleared
        ground around it; it grows as the colony digs. Dug <b>exits</b> are small craters. Everything below ground
        is in the <b>Underground</b> view (Controls bar).</li>
      <li>Every spot on the ground is a <b>ring in its task's colour</b> with the real thing inside:
        <b>food</b> is a group of fallen leaves (fewer as ants carry them off; foragers carry a piece home), the
        <b>midden</b> a heap of refuse (soil, husks, dead nestmates) that grows with what cleaners dump and shrinks
        as it rots. Nothing is ever placed in water, on a rock or on the anthill.</li>
      <li><b>Protected band</b>: the blue ring around the nest, with low kerbs at its edges, where patrollers walk.
        Brighter when protection keeps up.</li>
      <li><b>Task sites</b>: each task has its own shape on a base in its colour: a <b>palisade</b> (protection),
        the <b>queen's chamber</b>, a cluster of <b>eggs</b> (brood care), a
        <b>silo</b> (store), <b>soil heaps</b> (expansion) and a stack of <b>swept stones</b> (cleaning).
        One rule for all of them: the fuller or taller the shape, the better the task is supplied
        (actual ÷ need). A shape that <i>breathes</i> is badly under-served.</li>
      ${AUTODISCOVERING ? '<li><b>Faded sites</b> are undiscovered: they exist, but no ant knows the way yet, so there is no road.</li>' : ''}
      <li>The glowing <b>trails</b> on the ground are the routes ants actually walk (see Terrain, routes and
        trails).</li>
      <li><b>Ants</b> take their task's colour. Newly emerged ants are <b>pale</b> (callow, as in real colonies) and darken to their full colour as they mature. <b>Brightness</b> shows how much of the map an ant truly knows (sites, and a food spot that still has food): a dim ant knows little, a bright one a lot. Half-transparent ants are asleep.</li>
      <li><b>Rings</b> from the nest: work delivered (in that task's colour) or a birth (white).
        <b>White spark</b>: two ants met and one taught the other where a site is. <b>Grey spark</b>: a death.</li>
      <li><b>Small rings</b> (only while a task is pinned): an encounter between one of its ants and another
        ant, coloured by the other ant's task.</li>
      <li>The <b>dashed circle</b> is the colony's territory, where food spots appear. Its <b>size</b> is
        expansion: digging widens it, because the easy food nearby is used up and new food turns up further
        out (the <b>Nest expansion</b> bar measures the same). Its <b>brightness</b> is scouting:
        exploration has no site, since scouts roam the whole territory, so the circle is its gauge. Bright
        means scouting keeps up, faint means it lags, and breathing means badly under-served.</li>
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
      <li><b>Scouts</b> (the Exploration task) roam random points in the territory, notice every site and
        food spot they pass, and pass the news on to the ants who need it.</li>
      <li>When two ants meet, each can teach the other where its own task's site is. Knowledge spreads through
        the colony by encounters, with no map and no leader.</li>
      <li>Collectors remember <b>one food spot</b> each and pass it on to collectors they meet. When a spot is
        emptied, nobody announces it: the ant that finds it empty spreads the news to every ant it meets,
        and an ant on its way there that hears it turns back. The rest of the colony keeps foraging its own
        spots.</li>
    </ul>`,
  },
  {
    id: 'life',
    title: 'Food, the queen, life and death',
    body: `<ul>
      <li><b>Food in</b>: collectors bring food home, less per trip the more of them share the site.
        <b>Food out</b>: every ant eats (big ants twice as much), and the store spoils unless Store work keeps up.
        A thin reserve raises the need to collect.</li>
      <li><b>Births</b>: only the queen lays. Her rate follows the food reserve (half speed at about ten
        minutes of food left, so the colony stops breeding before a famine, not in it) and how well she is
        cared for, and every egg costs food.</li>
      <li><b>Deaths</b>: each ant has its own lifespan (0.6–1.4× the mean). Work outside the nest (collection,
        exploration, protection, cleaning, expansion) adds risk, so foragers die younger. An empty store
        starves ants.</li>
      <li><b>Ageing follows the season</b>: in the cold the body slows down, so ants age at a quarter of the
        pace in winter. Workers that overwinter live far longer than summer workers, which is how a real
        colony outlasts the months when the queen barely lays.</li>
      <li><b>Sleep</b>: ants take short naps and meet no one while asleep. The sleep chamber under the nest
        holds about 30. When it is full, sleepers lie down in the nearest dug room set aside for sleeping
        (see <i>Rooms</i> below).</li>
      <li>So the <b>population is not a setting</b>. It settles wherever food income, the queen and mortality
        balance out.</li>
    </ul>`,
  },
  {
    id: 'seasons',
    title: 'Seasons',
    body: `<p>With <b>Cycle</b> on (Controls bar) a year lasts 40 sim minutes, 10 per season, blending
      smoothly from one to the next. Click a season to jump to it, or turn Cycle off to stay in it. Seasons change how the colony <i>lives</i>, not only how much food
      there is:</p>
      <ul>
        <li><b>Spring</b>: food returns (×1.5), the queen lays more.</li>
        <li><b>Summer</b>: food peaks (×2), stores spoil faster in the heat.</li>
        <li><b>Autumn</b>: food thins (×0.75), laying slows, ants rest more.</li>
        <li><b>Winter</b>: little food (×0.25), the queen nearly stops, ants eat far less and mostly rest in
          the chamber. The colony lives off what it stored.</li>
      </ul>
      <p>The climate's baseline (<code>FOOD_AVAILABILITY</code>) is multiplied by the season: a rich
        climate has mild winters, a poor one hard ones. The ground grid takes a faint seasonal tint, and each
        new season pops up as a notification.</p>`,
  },
  {
    id: 'terrain',
    title: 'Terrain, routes and trails',
    body: `<ul>
      <li>The colony lives on a <b>landscape</b>: hills slow ants down when they climb, <b>water</b> fills the
        lowest hollows and <b>rocks</b> stand in the way. Neither can be crossed.</li>
      <li>Ants <b>walk</b> at their own pace, so a trip takes as long as its distance and slope make it.
        Tunnels to the chambers under the nest are quick.</li>
      <li>No ant plans a route. Each step, an ant chooses between neighbouring patches of ground, weighing
        how much the step brings it towards its goal (ants know the <i>direction</i> of their goal and of
        home, not the way around obstacles) against the <b>trail</b> already there.</li>
      <li>Ants lay trail as they walk: strongly when coming home with food or from finished work, faintly
        otherwise. Trails fade. Routes that work are walked more and glow brighter; detours fade away.
        The glowing paths on the ground are those trails: the colony's routes, written into the ground.</li>
      <li>On the ground, <b>trails</b> glow warm amber (routes that work: follow) and <b>no-entry</b> marks cold
        cyan (dead ends: avoid), since the colony reads them in opposite ways.</li>
      <li>An ant stuck in a dead end lays a short-lived <b>"no entry"</b> mark on the pocket it was circling
        (Pharaoh ants do this at unrewarding branches), and the ants behind it steer clear, so they don't
        pile up in the same trap. Marks near an ant's own goal are ignored: it may have to go in there.</li>
      <li>An ant hopelessly stuck behind an obstacle eventually falls back on a planned route; how rarely
        that happens is a measure of how well the trails work.</li>
    </ul>`,
  },
  {
    id: 'roles',
    title: 'Who does what on the ground',
    body: `<ul>
      <li><b>Patrollers</b> (protection) walk points spread through the <b>protected band</b>, the blue ring
        around the nest inside the fence. The band is brighter when protection keeps up.</li>
      <li><b>Cleaners</b> pick up the <b>debris</b> lying around the entrance (soil dug out, crumbs from
        meals, and nestmates that died near the nest) and carry it to the midden. With nothing lying
        around, they go straight to the midden.</li>
      <li><b>Foragers</b> bringing food home carry a seed, and cleaners carry their piece of debris.</li>
      <li>Underground: the <b>granary</b> fills with seed piles, the <b>nursery</b> with eggs and larvae, the
        <b>queen</b> rests in her chamber, the sleep chamber swells with sleepers, and new galleries are
        drawn below as the nest expands.</li>
      <li>None of this changes how ants choose their task: that decision stays the colony's own.</li>
    </ul>`,
  },
  {
    id: 'rooms',
    title: 'Expansion: tunnels, rooms and new exits',
    body: `<ul>
      <li>The nest starts as the queen's <b>founding chamber</b> (it holds a little brood and food), a first
        store room and a first nursery. Every other room is dug.</li>
      <li>Diggers extend the nest the way real nests grow: <b>shafts</b> wander down and <b>galleries</b> run
        roughly level to flat chambers. Tunnels bend; diggers go for open ground, outwards and down, and
        digging deeper is harder, so most chambers are near the top.</li>
      <li><b>Rooms take a role when there is no space left</b>: sleeping (sleep chamber full), nursery or
        store. One role per room, never mixed. How much a room holds depends on its size. The free room
        nearest the others of that role is taken first; an empty room no longer needed is freed again.</li>
      <li><b>What doesn't fit</b>: food with no store room lies in the tunnels and spoils fast; brood with no
        nursery room is cared for worse. That crowding is what makes the colony dig: the need for
        Expansion rises with it, so the nest grows when it is full, not by the clock.</li>
      <li>You see the role by what is inside: sleeping ants, eggs and larvae, or seed piles. Brood carers
        and storers go and tend those rooms too.</li>
      <li><b>New exits</b>: now and then a shallow tunnel far enough from the nest is dug up to the surface,
        a small crater with a dark hole. An ant going out walks underground to the entrance nearest its
        goal and comes up there, unless the trip that way is clearly longer; coming home, it may go in
        through an exit the same way. New trails grow from every exit, so exits open up new routes.</li>
    </ul>`,
  },
  {
    id: 'brood',
    title: 'Brood: from egg to worker',
    body: `<ul>
      <li>The queen lays <b>eggs</b>, not ants. Brood (egg → larva → pupa) develops for about a third of a
        worker's life before a new worker emerges. That emergence is what "born" counts.</li>
      <li>The need for <b>brood care</b> comes from the brood itself, so it follows the eggs laid: it booms
        in spring and almost vanishes in winter.</li>
      <li>Well-cared-for brood develops at full speed; neglected brood develops slowly and some of it
        dies. Larvae also eat.</li>
      <li>In famine the colony <b>eats its brood</b> before adults starve, getting part of the food back.
        Real colonies do the same: brood is the colony's buffer.</li>
      <li><i>Experimental:</i> <b>frozen ground</b>. In winter (and a little in late autumn) digging achieves
        much less. You can see it as a faint frost on the ground and icy soil heaps.</li>
    </ul>`,
  },
  {
    id: 'controls',
    title: 'Controls',
    body: `<ul>
      <li><b>Season</b> (Controls bar): four points, Spring to Winter. Click one to set it. With
        <b>Cycle</b> on, the year keeps turning from there; with it off, the colony stays in that season,
        e.g. to watch a long winter.</li>
      <li>Speed slider: pause to 16×. <kbd>Space</kbd> pauses, <kbd>[</kbd> <kbd>]</kbd> step slower / faster.
        Everything (timers, lifespans, movement) follows the same clock.</li>
      <li>Drag to orbit, scroll to zoom. Click a site's base to fly to it, and <kbd>H</kbd> returns to the nest.</li>
      <li><b>Surface / Underground</b> (Controls bar, or <kbd>U</kbd>): two views instead of one see-through one.
        Surface shows the solid ground and what happens on it. Underground fades the surface to a ghost overhead
        and shows the nest: each room is a closed shell, its upper half solid in the colour of what it is used for
        (store green, nursery amber, sleeping blue, the queen's chamber, plain earth when free) and its lower half
        see-through, so you see what is in it; tunnels are thin cords the ants move along. The view also goes underground by itself while the camera is below the ground or an
        underground task (queen care, brood care, store, expansion) is highlighted; the Underground point is
        then outlined dashed.</li>
      <li>All settings live in the <b>Controls</b> bar at the bottom; the Anthill panel only reports.</li>
      <li>The <b>speaker</b> in the Controls bar turns on quiet cues for turning points you might not be looking
        at: a food spot running out (falling note), a new food spot found (rising note), the store running
        low or empty (low tones) and recovering, and a new generation (a bell). Births and deaths make tiny ticks (high) and tocks (low), so you can hear whether the colony is growing. Off by default.</li>
      <li>The same turning points also pop up as small <b>notifications</b> in the bottom-right corner,
        with sound on or off, piling up when the same thing repeats. They last about 20 seconds of sim time
        (shorter at high speed) and freeze while paused; click one to dismiss it. Above them, each birth
        floats up as <b>+1</b> and each death as <b>−1</b>.</li>
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
