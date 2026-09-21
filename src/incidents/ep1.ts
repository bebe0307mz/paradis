// Episode 1 — "The Fall of Shiganshina" (Year 845)
// The entire episode is a PURE function of time t. All randomness is seeded at
// module init, so seeking/scrubbing the timeline is exact and repeatable.

import { SHI_INNER_GATE, SHI_OUTER_GATE } from '../world/constants'
import { mulberry32, range } from '../world/rng'
import type { IncidentFrame, PersonState, TitanState, Vec3 } from '../world/types'

export const EP1_DURATION = 80

const T_FLASH = 8
const T_KICK_START = 13.2
const T_OUTER_BREACH = 14.2
const T_PANIC = 16
const T_COLOSSAL_VANISH = 38
const T_ARMORED_SPAWN = 55
const T_INNER_BREACH = 64
const T_ENDCARD = 72

const GATE = { x: SHI_INNER_GATE[0], z: SHI_INNER_GATE[2] } // inner gate through Wall Maria
const OUTER = { x: SHI_OUTER_GATE[0], z: SHI_OUTER_GATE[2] } // outer district gate

// ---------------------------------------------------------------------------
// deterministic setup
// ---------------------------------------------------------------------------
const rand = mulberry32(845)

interface Keyframe {
  t: number
  x: number
  z: number
}

interface PureTitan {
  id: string
  height: number
  spawnT: number
  frames: Keyframe[]
  /** eat windows: [start, end, grabX, grabZ] — titan is stationary, mouth busy */
  eats: { start: number; end: number; x: number; z: number }[]
}

const EAT_DUR = 2.8

function buildPureTitans(): PureTitan[] {
  const titans: PureTitan[] = []
  const n = 13
  for (let k = 0; k < n; k++) {
    const height = range(rand, 5, 15)
    // fast enough that every eat-window lands INSIDE the 80s timeline
    const speed = 3.5 + height * 0.45
    const spawnT = 16.5 + k * 2.4 + range(rand, 0, 1.2)
    const frames: Keyframe[] = []
    const eats: PureTitan['eats'] = []
    let x = range(rand, -14, 14)
    let z = OUTER.z - 8
    let t = spawnT
    frames.push({ t, x, z })
    // stalk inward toward the town in 4 legs with lateral drift
    const legs = [
      { z: OUTER.z - range(rand, 70, 120), drift: 90 },
      { z: OUTER.z - range(rand, 180, 240), drift: 150 },
      { z: OUTER.z - range(rand, 300, 360), drift: 180 },
      { z: GATE.z + range(rand, 50, 130), drift: 170 },
    ]
    const hunter = k < 9
    for (let li = 0; li < legs.length; li++) {
      const nx = range(rand, -legs[li].drift, legs[li].drift)
      const nz = legs[li].z
      const dist = Math.hypot(nx - x, nz - z)
      t += dist / speed
      frames.push({ t, x: nx, z: nz })
      x = nx
      z = nz
      // hunters feed after early legs; the first few keep feeding deeper in
      const feeds = hunter && (li < 2 || (k < 4 && li === 2))
      if (feeds && t < EP1_DURATION - 12) {
        eats.push({ start: t, end: t + EAT_DUR, x, z })
        t += EAT_DUR
        frames.push({ t, x, z })
      }
    }
    titans.push({ id: `pure-${k}`, height, spawnT, frames, eats })
  }
  return titans
}

const PURE_TITANS = buildPureTitans()

interface Person {
  homeX: number
  homeZ: number
  loiterPhase: number
  loiterR: number
  fleeDelay: number
  fleeSpeed: number
  /** if a victim: when they get grabbed and by which titan mouth point */
  grabT?: number
  grabX?: number
  grabZ?: number
  titanId?: string
  titanHeight?: number
}

function buildPeople(): Person[] {
  const people: Person[] = []
  const n = 850
  for (let i = 0; i < n; i++) {
    // homes fill the semicircular district (flat side = Wall Maria, bulge outward)
    const a = range(rand, -1.35, 1.35) // angle from +Z at the inner gate
    const r = range(rand, 70, 500)
    people.push({
      homeX: GATE.x + Math.sin(a) * r,
      homeZ: GATE.z + Math.cos(a) * r,
      loiterPhase: rand() * Math.PI * 2,
      loiterR: range(rand, 2, 7),
      fleeDelay: range(rand, 0, 3.5),
      fleeSpeed: range(rand, 4.2, 6.8),
    })
  }
  // assign victims: for every titan eat-window, grab the unclaimed person
  // whose home is closest to the titan's pause spot (keeps flee speeds sane)
  const claimed = new Set<number>()
  for (const titan of PURE_TITANS) {
    for (const eat of titan.eats) {
      let best = -1
      let bestD = Infinity
      for (let i = 0; i < people.length; i++) {
        if (claimed.has(i)) continue
        const d = Math.hypot(people[i].homeX - eat.x, people[i].homeZ - eat.z)
        if (d < bestD) {
          bestD = d
          best = i
        }
      }
      if (best >= 0) {
        claimed.add(best)
        const p = people[best]
        p.grabT = eat.start
        p.grabX = eat.x
        p.grabZ = eat.z
        p.titanId = titan.id
        p.titanHeight = titan.height
      }
    }
  }
  return people
}

const PEOPLE = buildPeople()
const VICTIM_COUNT = PEOPLE.filter((p) => p.grabT !== undefined).length

// ---------------------------------------------------------------------------
// static event exports — Gore/Fires render from these + frame.t (deterministic)
// ---------------------------------------------------------------------------

export interface KillEvent {
  /** the bite moment — the person reaches the mouth at grabT + 1.6 */
  t: number
  x: number
  z: number
  /** mouth height of the titan doing the eating */
  mouthY: number
}

/** every on-screen death, in no particular order */
export const KILL_EVENTS: KillEvent[] = PEOPLE.filter(
  (p) => p.grabT !== undefined && p.grabT + 1.6 <= EP1_DURATION,
).map((p) => ({
  t: p.grabT! + 1.6,
  x: p.grabX!,
  z: p.grabZ!,
  mouthY: (p.titanHeight ?? 8) * 0.86,
}))

export interface FireSpot {
  x: number
  z: number
  /** ignition time; flames grow over ~5s from here */
  t0: number
  /** size multiplier */
  scale: number
}

/** buildings that catch fire after the breach, biased toward the outer gate */
export const FIRE_SPOTS: FireSpot[] = Array.from({ length: 16 }, (_, k) => ({
  x: range(rand, -280, 280),
  z: OUTER.z - range(rand, 50, 430),
  t0: T_OUTER_BREACH + 2 + k * 2.1 + range(rand, 0, 2),
  scale: range(rand, 0.8, 1.7),
}))

// ---------------------------------------------------------------------------
// preallocated frame (mutated in place every eval — renderer must not cache)
// ---------------------------------------------------------------------------
const personStates: PersonState[] = PEOPLE.map(() => ({
  pos: [0, 0, 0] as Vec3,
  yaw: 0,
  mode: 'calm',
  speed: 0,
}))

const pureStates: TitanState[] = PURE_TITANS.map((pt) => ({
  id: pt.id,
  kind: 'pure',
  height: pt.height,
  pos: [0, 0, 0] as Vec3,
  yaw: 0,
  walkSpeed: 0,
  eating: 0,
  crouch: 0,
  down: 0,
  steam: 0,
  attack: 0,
  carry: 0,
  visible: false,
}))

const colossalState: TitanState = {
  id: 'colossal',
  kind: 'colossal',
  height: 60,
  pos: [0, 0, OUTER.z + 28],
  yaw: Math.PI, // facing the town (-Z)
  walkSpeed: 0,
  eating: 0,
  crouch: 0,
  down: 0,
  steam: 0,
  attack: 0,
  carry: 0,
  visible: false,
}

const armoredState: TitanState = {
  id: 'armored',
  kind: 'armored',
  height: 15,
  pos: [0, 0, 0],
  yaw: Math.PI,
  walkSpeed: 0,
  eating: 0,
  crouch: 0,
  down: 0,
  steam: 0,
  attack: 0,
  carry: 0,
  running: true,
  visible: false,
}

const ARMORED_PATH: Keyframe[] = [
  { t: T_ARMORED_SPAWN, x: 90, z: OUTER.z - 160 },
  { t: T_ARMORED_SPAWN + 5.5, x: 20, z: GATE.z + 150 },
  { t: T_INNER_BREACH, x: 0, z: GATE.z + 5 },
  { t: T_INNER_BREACH + 4, x: 0, z: GATE.z - 180 },
  { t: T_INNER_BREACH + 7, x: 0, z: GATE.z - 260 },
]

const frame: IncidentFrame = {
  active: false,
  id: null,
  t: 0,
  duration: EP1_DURATION,
  flash: 0,
  shake: 0,
  outerGateBroken: false,
  outerGateAge: -1,
  innerGateBroken: false,
  innerGateAge: -1,
  colossal: null,
  colossalSteam: 0,
  atmosphere: 0,
  armored: null,
  rogue: null,
  pures: pureStates,
  people: personStates,
  soldiers: [],
  boulder: null,
  deaths: 0,
  soldiersLost: 0,
  titansSlain: 0,
  caption: null,
  endCard: false,
  victory: false,
}

// ---------------------------------------------------------------------------
// evaluation helpers
// ---------------------------------------------------------------------------
function sampleKeyframes(frames: Keyframe[], t: number): { x: number; z: number; yaw: number; moving: boolean } {
  if (t <= frames[0].t) return { x: frames[0].x, z: frames[0].z, yaw: Math.PI, moving: false }
  for (let i = 0; i < frames.length - 1; i++) {
    const a = frames[i]
    const b = frames[i + 1]
    if (t <= b.t) {
      const span = b.t - a.t
      const f = span > 0 ? (t - a.t) / span : 1
      const x = a.x + (b.x - a.x) * f
      const z = a.z + (b.z - a.z) * f
      const dx = b.x - a.x
      const dz = b.z - a.z
      const still = Math.hypot(dx, dz) < 0.01
      return { x, z, yaw: still ? sampleYawBack(frames, i) : Math.atan2(dx, dz), moving: !still }
    }
  }
  const last = frames[frames.length - 1]
  return { x: last.x, z: last.z, yaw: sampleYawBack(frames, frames.length - 1), moving: false }
}

function sampleYawBack(frames: Keyframe[], i: number): number {
  for (let j = i; j > 0; j--) {
    const dx = frames[j].x - frames[j - 1].x
    const dz = frames[j].z - frames[j - 1].z
    if (Math.hypot(dx, dz) > 0.01) return Math.atan2(dx, dz)
  }
  return Math.PI
}

const CAPTIONS: [number, number, string][] = [
  [0.5, 7.5, 'Shiganshina District — Year 845. For a hundred years, the walls have held.'],
  [8.4, 13, 'It appeared without warning. Sixty meters — taller than the wall itself.'],
  [14.5, 19.5, 'The gate is gone. A hundred years of peace, ended by a single kick.'],
  [20.5, 26, 'Titans pour in. They do not eat because they are hungry.'],
  [29.5, 34.5, 'Among the first taken: Carla Yeager, pulled from the rubble of her home. Her son is watching.'],
  [35.2, 38, 'People run for the inner gate. Not all of them make it.'],
  [38.6, 43.5, 'Its work done, the Colossal Titan vanishes into steam.'],
  [46, 53, 'The boats take the lucky ones. The rest wait at the gate as the screams come closer.'],
  [55.2, 61.5, 'Something is charging the inner gate —'],
  [64.4, 70.5, 'The Armored Titan. Wall Maria has fallen.'],
]

/** canon aftermath, per the Attack on Titan wiki — rendered on the end card */
export const EP1_AFTERMATH = [
  'A third of humanity’s territory is abandoned in a single day.',
  'Year 846 — with the food running out, the Crown sends 250,000 refugees, one fifth of humanity, to “reclaim” Wall Maria.',
  'Fewer than 200 return.',
]

function decay(since: number, peak: number, halflife: number): number {
  if (since < 0) return 0
  return peak * Math.exp(-since / halflife)
}

// ---------------------------------------------------------------------------
// main evaluation — mutates and returns the shared frame object
// ---------------------------------------------------------------------------
export function evalEp1(t: number, active: boolean): IncidentFrame {
  frame.active = active
  frame.id = active ? 'ep1' : null
  frame.t = t
  frame.endCard = active && t >= T_ENDCARD

  // flash + shake
  frame.flash = t >= T_FLASH ? Math.max(0, 1 - (t - T_FLASH) / 0.5) : 0
  frame.shake =
    decay(t - T_OUTER_BREACH, 0.9, 0.9) +
    decay(t - T_INNER_BREACH, 1.2, 1.1) +
    (t >= T_ARMORED_SPAWN && t < T_INNER_BREACH ? 0.12 : 0)

  // hell ramp: the world grades from pastoral to burning over ~12s post-breach
  frame.atmosphere = active
    ? Math.min(1, Math.max(0, (t - T_OUTER_BREACH) / 12)) + (t >= T_FLASH && t < T_OUTER_BREACH ? 0.15 : 0)
    : 0

  // gates
  frame.outerGateBroken = t >= T_OUTER_BREACH
  frame.outerGateAge = frame.outerGateBroken ? t - T_OUTER_BREACH : -1
  frame.innerGateBroken = t >= T_INNER_BREACH
  frame.innerGateAge = frame.innerGateBroken ? t - T_INNER_BREACH : -1

  // colossal
  if (t >= T_FLASH && t < T_COLOSSAL_VANISH + 2.5) {
    colossalState.visible = t < T_COLOSSAL_VANISH + 1.2
    // kick wind-up and swing
    if (t >= T_KICK_START && t < T_OUTER_BREACH + 0.8) {
      const f = (t - T_KICK_START) / (T_OUTER_BREACH + 0.8 - T_KICK_START)
      colossalState.crouch = Math.sin(f * Math.PI)
    } else {
      colossalState.crouch = 0
    }
    frame.colossal = colossalState
    frame.colossalSteam =
      t >= T_COLOSSAL_VANISH ? Math.min(1, (t - T_COLOSSAL_VANISH) / 1.5) : t > 9 ? 0.25 : 0
  } else {
    frame.colossal = null
    frame.colossalSteam = 0
  }

  // armored
  if (t >= T_ARMORED_SPAWN) {
    const s = sampleKeyframes(ARMORED_PATH, t)
    armoredState.pos[0] = s.x
    armoredState.pos[2] = s.z
    armoredState.yaw = s.yaw
    armoredState.walkSpeed = s.moving ? 40 : 0
    armoredState.crouch = s.moving && t < T_INNER_BREACH ? 0.35 : 0
    armoredState.visible = true
    frame.armored = armoredState
  } else {
    frame.armored = null
  }

  // pure titans
  for (let i = 0; i < PURE_TITANS.length; i++) {
    const pt = PURE_TITANS[i]
    const st = pureStates[i]
    if (!active || t < pt.spawnT) {
      st.visible = false
      continue
    }
    st.visible = true
    const s = sampleKeyframes(pt.frames, t)
    st.pos[0] = s.x
    st.pos[2] = s.z
    st.yaw = s.yaw
    st.walkSpeed = s.moving ? 1.6 + pt.height * 0.28 : 0
    st.eating = 0
    for (const eat of pt.eats) {
      if (t >= eat.start && t <= eat.end) st.eating = (t - eat.start) / (eat.end - eat.start)
    }
  }

  // people
  let deaths = 0
  for (let i = 0; i < PEOPLE.length; i++) {
    const p = PEOPLE[i]
    const st = personStates[i]
    const grabbed = p.grabT !== undefined && active && t >= p.grabT
    if (grabbed) {
      const gf = (t - p.grabT!) / 1.6
      if (gf >= 1) {
        deaths++
        st.mode = 'gone'
        continue
      }
      // lifted from the street to the titan's mouth
      st.mode = 'grabbed'
      const mouthY = (p.titanHeight ?? 8) * 0.86
      st.pos[0] = p.grabX!
      st.pos[1] = gf * gf * mouthY
      st.pos[2] = p.grabZ!
      st.speed = 0
      continue
    }
    const panicked = active && t >= T_PANIC + p.fleeDelay
    if (!panicked) {
      // calm loiter around home
      const ph = p.loiterPhase + t * 0.35
      st.mode = 'calm'
      st.pos[0] = p.homeX + Math.cos(ph) * p.loiterR
      st.pos[1] = 0
      st.pos[2] = p.homeZ + Math.sin(ph) * p.loiterR * 0.6
      st.yaw = ph + Math.PI / 2
      st.speed = 0.8
      continue
    }
    // fleeing toward the inner gate, victims route through their grab point
    const t0 = T_PANIC + p.fleeDelay
    const targetX = p.grabT !== undefined ? p.grabX! : GATE.x + (p.homeX % 13)
    const targetZ = p.grabT !== undefined ? p.grabZ! : GATE.z + 4
    const dx = targetX - p.homeX
    const dz = targetZ - p.homeZ
    const dist = Math.hypot(dx, dz)
    const arrive = p.grabT !== undefined ? p.grabT! : t0 + dist / p.fleeSpeed
    if (t >= arrive && p.grabT === undefined) {
      // escaped through the gate into Wall Maria interior, then despawn
      const past = (t - arrive) * p.fleeSpeed
      if (past > 90) {
        st.mode = 'gone'
        continue
      }
      st.mode = 'flee'
      st.pos[0] = targetX * 0.2
      st.pos[1] = 0
      st.pos[2] = targetZ - past
      st.yaw = Math.PI
      st.speed = p.fleeSpeed
      continue
    }
    const f = Math.min(1, (t - t0) / Math.max(0.001, arrive - t0))
    st.mode = 'flee'
    st.pos[0] = p.homeX + dx * f
    st.pos[1] = 0
    st.pos[2] = p.homeZ + dz * f
    st.yaw = Math.atan2(dx, dz)
    st.speed = p.fleeSpeed
  }
  frame.deaths = deaths

  // caption
  frame.caption = null
  if (active) {
    for (const [a, b, text] of CAPTIONS) {
      if (t >= a && t <= b) {
        frame.caption = text
        break
      }
    }
  }

  return frame
}

export const EP1_META = {
  id: 'ep1',
  title: 'The Fall of Shiganshina',
  year: 845,
  duration: EP1_DURATION,
  victims: VICTIM_COUNT,
}
