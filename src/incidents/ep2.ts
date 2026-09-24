// Episode 2 — "The Battle of Trost" (Year 850)
// Same doctrine as ep1: the WHOLE battle is a pure function of time t.
// New machinery: ODM soldiers on cables, titans that get killed (nape cuts and
// Rogue Titan punches), the Rogue Titan itself, and the boulder that seals the
// breach. Everything seeded/keyframed at module init; scrubbing is exact.

import { TRO_INNER_GATE, TRO_OUTER_GATE } from '../world/constants'
import { mulberry32, range } from '../world/rng'
import type {
  BoulderState,
  IncidentFrame,
  PersonState,
  SoldierState,
  TitanState,
  Vec3,
} from '../world/types'

export const EP2_DURATION = 100

const T_FLASH = 8
const T_KICK_START = 13.2
const T_BREACH = 14.2
const T_PANIC = 15
const T_VANISH = 19 // canon: at Trost the Colossal disappeared right after the kick
const T_ERUPT = 38 // the Rogue Titan tears out of the titan that ate Eren
// T_LIFT / T_CARRY / T_SLAM / T_SEALED / T_ENDCARD derive from the end of the
// rogue's chase (computed below) so the timeline can never self-overlap

const GATE = { x: TRO_INNER_GATE[0], z: TRO_INNER_GATE[2] } // inner gate (Wall Rose)
const OUTER = { x: TRO_OUTER_GATE[0], z: TRO_OUTER_GATE[2] } // breached outer gate

const BOULDER_REST: Vec3 = [-150, 5, GATE.z + 230]

// ---------------------------------------------------------------------------
// deterministic setup
// ---------------------------------------------------------------------------
const rand = mulberry32(850)

interface Keyframe {
  t: number
  x: number
  z: number
}

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
      return { x, z, yaw: still ? yawBack(frames, i) : Math.atan2(dx, dz), moving: !still }
    }
  }
  const last = frames[frames.length - 1]
  return { x: last.x, z: last.z, yaw: yawBack(frames, frames.length - 1), moving: false }
}

function yawBack(frames: Keyframe[], i: number): number {
  for (let j = i; j > 0; j--) {
    const dx = frames[j].x - frames[j - 1].x
    const dz = frames[j].z - frames[j - 1].z
    if (Math.hypot(dx, dz) > 0.01) return Math.atan2(dx, dz)
  }
  return Math.PI
}

// ---------------------------------------------------------------------------
// pure titans — 11 invaders. Some eat, most die: three to nape cuts, one to the
// eruption, five to Rogue Titan fists.
// ---------------------------------------------------------------------------
interface PureTitan {
  id: string
  height: number
  spawnT: number
  frames: Keyframe[]
  eats: { start: number; end: number; x: number; z: number }[]
  /** when (and how) this titan dies; undefined = survives the episode */
  deathT?: number
  deathBy?: 'nape' | 'eruption' | 'punch'
}

const EAT_DUR = 2.8

function buildPures(): PureTitan[] {
  const titans: PureTitan[] = []
  const n = 11
  for (let k = 0; k < n; k++) {
    const height = range(rand, 6, 15)
    const speed = 3.5 + height * 0.45
    const spawnT = 15 + k * 2.2 + range(rand, 0, 1.2)
    const frames: Keyframe[] = []
    const eats: PureTitan['eats'] = []
    // enter THROUGH the breach: appear outside the outer gate and funnel in
    // through the hole so the broken gate visibly feeds the invasion
    let x = range(rand, -9, 9)
    let z = OUTER.z + 12
    let t = spawnT
    frames.push({ t, x, z })
    {
      const ix = range(rand, -13, 13)
      const iz = OUTER.z - 18
      t += Math.hypot(ix - x, iz - z) / speed
      frames.push({ t, x: ix, z: iz })
      x = ix
      z = iz
    }
    const legs = [
      { z: OUTER.z - range(rand, 70, 120), drift: 90 },
      { z: OUTER.z - range(rand, 180, 250), drift: 150 },
      { z: OUTER.z - range(rand, 310, 380), drift: 180 },
      { z: GATE.z + range(rand, 60, 140), drift: 160 },
    ]
    const hunter = k === 0 || k === 3 || k === 5
    for (let li = 0; li < legs.length; li++) {
      const nx = range(rand, -legs[li].drift, legs[li].drift)
      const nz = legs[li].z
      const dist = Math.hypot(nx - x, nz - z)
      t += dist / speed
      frames.push({ t, x: nx, z: nz })
      x = nx
      z = nz
      if (hunter && li < 2 && t < 40) {
        eats.push({ start: t, end: t + EAT_DUR, x, z })
        t += EAT_DUR
        frames.push({ t, x, z })
      }
    }
    titans.push({ id: `pure-${k}`, height, spawnT, frames, eats })
  }
  return titans
}

const PURE_TITANS = buildPures()

// pure-1 is the bearded titan that swallows Eren, then dies when the Rogue
// erupts out of it. Freeze it near its position at the eruption moment.
PURE_TITANS[1].deathT = T_ERUPT
PURE_TITANS[1].deathBy = 'eruption'

// Garrison nape kills
const NAPE_KILLS: { titan: number; t: number }[] = [
  { titan: 2, t: 26 },
  { titan: 4, t: 31 },
  { titan: 6, t: 36 },
  { titan: 8, t: 58 },
  { titan: 9, t: 70 },
  { titan: 10, t: 74 },
]
for (const nk of NAPE_KILLS) {
  PURE_TITANS[nk.titan].deathT = nk.t
  PURE_TITANS[nk.titan].deathBy = 'nape'
}

// Rogue Titan punch victims, in hunt order. Times get finalized while building
// the rogue's path (arrival-dependent) — placeholders here.
const PUNCH_ORDER = [0, 3, 5, 7]

interface Punch {
  titan: number
  t: number
  x: number
  z: number
}

const ERUPT_AT = sampleKeyframes(PURE_TITANS[1].frames, T_ERUPT)

// Build the rogue path: erupt → roar → chase each punch victim (where that
// victim will actually be when the rogue reaches it) → boulder → gate.
const ROGUE_H = 15
const ROGUE_SPEED = 15
const PUNCHES: Punch[] = []
const ROGUE_PATH: Keyframe[] = []
{
  let t = T_ERUPT
  let x = ERUPT_AT.x
  let z = ERUPT_AT.z
  ROGUE_PATH.push({ t, x, z })
  t += 1.8 // the roar
  ROGUE_PATH.push({ t, x, z })
  // hunt the NEAREST victim next (greedy, against each victim's future
  // position) — keeps the whole fistfight inside the pre-boulder window
  const remaining = [...PUNCH_ORDER]
  while (remaining.length > 0) {
    let bestRi = 0
    let bestArrive = Infinity
    for (let ri = 0; ri < remaining.length; ri++) {
      const cand = PURE_TITANS[remaining[ri]]
      let arrive = t + 2
      for (let iter = 0; iter < 3; iter++) {
        const at = sampleKeyframes(cand.frames, arrive)
        const d = Math.hypot(at.x - x, at.z - z)
        arrive = t + Math.max(1.0, d / ROGUE_SPEED)
      }
      if (arrive < bestArrive) {
        bestArrive = arrive
        bestRi = ri
      }
    }
    const idx = remaining.splice(bestRi, 1)[0]
    const pt = PURE_TITANS[idx]
    const at = sampleKeyframes(pt.frames, bestArrive)
    ROGUE_PATH.push({ t: bestArrive, x: at.x, z: at.z })
    const punchT = bestArrive + 0.45
    PUNCHES.push({ titan: idx, t: punchT, x: at.x, z: at.z })
    pt.deathT = punchT
    pt.deathBy = 'punch'
    t = bestArrive + 1.1 // wind-up, impact, recover
    ROGUE_PATH.push({ t, x: at.x, z: at.z })
    x = at.x
    z = at.z
  }
}

// boulder timeline — anchored to wherever the fistfight actually ended
const CHASE_END = ROGUE_PATH[ROGUE_PATH.length - 1].t
const T_LIFT = Math.max(63, CHASE_END + 0.8)
const T_CARRY = T_LIFT + 3
const T_SLAM = T_CARRY + 11
const T_SEALED = T_SLAM + 0.8
const T_ENDCARD = Math.min(93, T_SLAM + 12)
{
  const last = ROGUE_PATH[ROGUE_PATH.length - 1]
  const d = Math.hypot(BOULDER_REST[0] - last.x, BOULDER_REST[2] - last.z)
  const arrive = Math.max(CHASE_END + 0.4, Math.min(CHASE_END + d / ROGUE_SPEED, T_CARRY - 2))
  ROGUE_PATH.push({ t: arrive, x: BOULDER_REST[0], z: BOULDER_REST[2] })
  ROGUE_PATH.push({ t: T_CARRY, x: BOULDER_REST[0], z: BOULDER_REST[2] })
  // the carry: slow march up the main street to the breach
  ROGUE_PATH.push({ t: T_CARRY + 4, x: -60, z: GATE.z + 320 })
  ROGUE_PATH.push({ t: T_CARRY + 7.5, x: -6, z: OUTER.z - 120 })
  ROGUE_PATH.push({ t: T_SLAM - 0.2, x: 0, z: OUTER.z - 26 })
  // after the seal: stagger back and kneel
  ROGUE_PATH.push({ t: T_SLAM + 1.6, x: 14, z: OUTER.z - 52 })
  ROGUE_PATH.push({ t: EP2_DURATION + 5, x: 14, z: OUTER.z - 52 })
}

// ---------------------------------------------------------------------------
// civilians — 500, mostly evacuating; six never make it
// ---------------------------------------------------------------------------
interface Person {
  homeX: number
  homeZ: number
  loiterPhase: number
  loiterR: number
  fleeDelay: number
  fleeSpeed: number
  grabT?: number
  grabX?: number
  grabZ?: number
  titanHeight?: number
}

function buildPeople(): Person[] {
  const people: Person[] = []
  const n = 500
  for (let i = 0; i < n; i++) {
    const a = range(rand, -1.35, 1.35)
    const r = range(rand, 70, 500)
    people.push({
      homeX: GATE.x + Math.sin(a) * r,
      homeZ: GATE.z + Math.cos(a) * r,
      loiterPhase: rand() * Math.PI * 2,
      loiterR: range(rand, 2, 7),
      fleeDelay: range(rand, 0, 2.5),
      fleeSpeed: range(rand, 4.5, 7),
    })
  }
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
        p.titanHeight = titan.height
      }
    }
  }
  return people
}

const PEOPLE = buildPeople()

// ---------------------------------------------------------------------------
// soldiers — 26 ODM troopers zipping between rooftop anchors
// ---------------------------------------------------------------------------
interface SoldierSeg {
  t0: number
  t1: number
  ax: number
  ay: number
  az: number
  bx: number
  by: number
  bz: number
  /** cable arc vs ground move */
  zip: boolean
}

/** a scripted titan fight: the soldier orbits the titan on a cable anchored to
 * it, swooping toward the nape. killT set = this soldier lands the cut. */
interface Engagement {
  soldier: number
  titan: number
  t0: number
  t1: number
  killT?: number
  dir: 1 | -1
  phase: number
}

interface Soldier {
  segs: SoldierSeg[]
  engs: Engagement[]
  /** killed at this time (flung, then a body on the ground) */
  deathT?: number
  /** eaten — no body left */
  eaten?: boolean
}

function buildSoldiers(): Soldier[] {
  const soldiers: Soldier[] = []
  const mk = (spawnT: number, ox: number, oz: number, patrolZ: number, seed: number): Soldier => {
    const r = mulberry32(seed)
    const segs: SoldierSeg[] = []
    let t = spawnT
    let x = ox
    let y = 12
    let z = oz
    for (let hop = 0; hop < 22; hop++) {
      let nx = Math.max(-320, Math.min(320, x + range(r, -70, 70)))
      let nz = Math.max(GATE.z + 40, Math.min(OUTER.z - 40, patrolZ + range(r, -90, 90)))
      // bias hops toward living titans — soldiers harass the enemy, they
      // don't sightsee. Roughly half of all hops aim near a titan.
      if (r() < 0.5) {
        const tv = PURE_TITANS[Math.floor(r() * PURE_TITANS.length)]
        const aliveUntil = tv.deathT ?? EP2_DURATION
        if (t > tv.spawnT + 1 && t < aliveUntil) {
          const at = sampleKeyframes(tv.frames, Math.min(t + 1.2, aliveUntil))
          nx = Math.max(-320, Math.min(320, at.x + range(r, -24, 24)))
          nz = Math.max(GATE.z + 40, Math.min(OUTER.z - 40, at.z + range(r, -24, 24)))
        }
      }
      const ny = 8 + r() * 8
      const d = Math.hypot(nx - x, nz - z)
      const dur = Math.max(0.9, d / 26) // zip speed ~26 m/s
      segs.push({ t0: t, t1: t + dur, ax: x, ay: y, az: z, bx: nx, by: ny, bz: nz, zip: true })
      t += dur
      // perch briefly
      segs.push({ t0: t, t1: t + 0.5 + r() * 1.2, ax: nx, ay: ny, az: nz, bx: nx, by: ny, bz: nz, zip: false })
      t = segs[segs.length - 1].t1
      x = nx
      y = ny
      z = nz
      if (t > EP2_DURATION + 4) break
    }
    return { segs, engs: [] }
  }

  // vanguard — engage near the breach
  for (let i = 0; i < 8; i++) {
    soldiers.push(mk(20 + i * 0.7, range(rand, -60, 60), GATE.z + 120, OUTER.z - 220, 7000 + i))
  }
  // mid guard — hold the center
  for (let i = 0; i < 10; i++) {
    soldiers.push(mk(26 + i * 0.8, range(rand, -120, 120), GATE.z + 90, GATE.z + 300, 7100 + i))
  }
  // escort — flank the boulder carry
  for (let i = 0; i < 8; i++) {
    soldiers.push(mk(58 + i * 0.6, range(rand, -180, -120), GATE.z + 200, GATE.z + 330, 7200 + i))
  }

  // scripted deaths. Index 4 is "Eren" — swallowed at t=33 by pure-1.
  const deaths: [number, number, boolean][] = [
    [2, 27, false],
    [6, 29.5, false],
    [4, 33, true], // Eren — eaten, no body
    [1, 35, false],
    [11, 44, false],
    [18, 68, false],
    [21, 71.5, false],
    [24, 74, false],
  ]
  for (const [idx, t, eaten] of deaths) {
    soldiers[idx].deathT = t
    soldiers[idx].eaten = eaten
  }

  // scripted titan fights. Every nape kill gets a killer + a wingman circling
  // the titan; every soldier death happens MID-FIGHT, not on a random rooftop.
  const engagements: Engagement[] = [
    // killer + wingman per Garrison nape kill
    { soldier: 0, titan: 2, t0: 22.8, killT: 26, t1: 28.5, dir: 1, phase: 0.4 },
    { soldier: 3, titan: 2, t0: 23.4, t1: 26.6, dir: -1, phase: 2.6 },
    { soldier: 5, titan: 4, t0: 27.5, killT: 31, t1: 33.5, dir: -1, phase: 1.2 },
    { soldier: 7, titan: 4, t0: 28.2, t1: 31.6, dir: 1, phase: 4.1 },
    { soldier: 9, titan: 6, t0: 32.5, killT: 36, t1: 38.5, dir: 1, phase: 2.0 },
    { soldier: 12, titan: 6, t0: 33.2, t1: 36.6, dir: -1, phase: 5.0 },
    { soldier: 13, titan: 8, t0: 54.5, killT: 58, t1: 60.5, dir: 1, phase: 3.0 },
    { soldier: 15, titan: 8, t0: 55.2, t1: 58.6, dir: -1, phase: 0.6 },
    { soldier: 19, titan: 9, t0: 66.5, killT: 70, t1: 72.5, dir: 1, phase: 0.9 },
    { soldier: 20, titan: 9, t0: 67.2, t1: 70.6, dir: -1, phase: 3.3 },
    { soldier: 22, titan: 10, t0: 70.5, killT: 74, t1: 76.5, dir: -1, phase: 1.7 },
    { soldier: 25, titan: 10, t0: 71.2, t1: 74.6, dir: 1, phase: 4.6 },
    // fights that go WRONG — these soldiers die inside the window
    { soldier: 2, titan: 0, t0: 24.0, t1: 27.4, dir: 1, phase: 1.1 },
    { soldier: 6, titan: 3, t0: 26.5, t1: 29.9, dir: -1, phase: 2.2 },
    { soldier: 4, titan: 1, t0: 30.0, t1: 33.4, dir: 1, phase: 0.2 }, // Eren vs the bearded titan
    { soldier: 1, titan: 5, t0: 31.8, t1: 35.4, dir: -1, phase: 3.9 },
    { soldier: 11, titan: 8, t0: 41.0, t1: 44.4, dir: 1, phase: 2.8 },
    { soldier: 18, titan: 9, t0: 65.3, t1: 68.4, dir: -1, phase: 5.5 },
    { soldier: 21, titan: 10, t0: 68.6, t1: 71.9, dir: 1, phase: 1.5 },
    { soldier: 24, titan: 10, t0: 71.6, t1: 74.4, dir: -1, phase: 0.7 },
  ]
  for (const e of engagements) soldiers[e.soldier].engs.push(e)
  return soldiers
}

const SOLDIERS = buildSoldiers()

function sampleSoldier(s: Soldier, t: number, st: SoldierState): void {
  // death: fling from wherever they were, then a body (or nothing, if eaten)
  if (s.deathT !== undefined && t >= s.deathT) {
    const df = t - s.deathT
    if (df > 0.9) {
      st.mode = s.eaten ? 'gone' : 'dead'
      if (st.mode === 'dead') {
        // resting place — deterministic from the fling
        sampleSoldierAlive(s, s.deathT, st)
        st.pos[0] += 6
        st.pos[1] = 0.25
        st.pos[2] += 3
        st.anchor[1] = -1
        st.speed = 0
      }
      return
    }
    sampleSoldierAlive(s, s.deathT, st)
    const vy = 7 - 26 * df
    st.pos[0] += df * 8
    st.pos[1] = Math.max(0.25, st.pos[1] + vy * df)
    st.pos[2] += df * 4
    st.mode = 'zip'
    st.anchor[1] = -1
    st.speed = 4
    return
  }
  sampleSoldierAlive(s, t, st)
}

const TMP_ST: SoldierState = { pos: [0, 0, 0], yaw: 0, mode: 'zip', anchor: [0, -1, 0], speed: 0 }

function sampleEngagement(e: Engagement, t: number, st: SoldierState): void {
  const pt = PURE_TITANS[e.titan]
  const h = pt.height
  // orbit a corpse-frozen center once the titan drops
  const c = sampleKeyframes(pt.frames, pt.deathT !== undefined ? Math.min(t, pt.deathT) : t)
  const napeY = h * 0.88
  const radius = Math.max(9, h * 0.85)
  const ang = e.phase + e.dir * (t - e.t0) * 2.6
  const climbEnd = (e.killT ?? e.t1) - 0.4
  const climb = clamp01((t - e.t0) / Math.max(0.001, climbEnd - e.t0))
  let x = c.x + Math.sin(ang) * radius
  let z = c.z + Math.cos(ang) * radius
  let y = h * 0.35 + (napeY - h * 0.35) * climb + Math.sin((t - e.t0) * 3.1) * h * 0.16
  if (e.killT !== undefined && t > e.killT - 0.35) {
    // the dive: spiral collapses onto the nape
    const f = clamp01((t - (e.killT - 0.35)) / 0.35)
    const bx = c.x - Math.sin(c.yaw) * h * 0.12
    const bz = c.z - Math.cos(c.yaw) * h * 0.12
    x += (bx - x) * f
    z += (bz - z) * f
    y += (napeY - y) * f
  }
  if (e.killT !== undefined && t > e.killT) {
    // break away in a rising arc off the collapsing titan
    const f = clamp01((t - e.killT) / Math.max(0.001, e.t1 - e.killT))
    x += Math.sin(e.phase) * 30 * f
    z += Math.cos(e.phase) * 30 * f
    y = napeY * (1 - f) + 12 * f + Math.sin(f * Math.PI) * 9
  }
  st.pos[0] = x
  st.pos[1] = Math.max(2.5, y)
  st.pos[2] = z
  st.yaw = ang + e.dir * (Math.PI / 2)
  st.mode = 'zip'
  st.anchor[0] = c.x
  st.anchor[1] = napeY + 7
  st.anchor[2] = c.z
  st.speed = 24
}

function sampleSoldierAlive(s: Soldier, t: number, st: SoldierState): void {
  let eng: Engagement | null = null
  for (const e of s.engs) {
    if (t >= e.t0 && t <= e.t1) {
      eng = e
      break
    }
  }
  if (!eng) {
    sampleSegs(s, t, st)
    return
  }
  sampleEngagement(eng, t, st)
  // blend in/out against the patrol path so entry and exit are continuous
  const IN = 0.9
  if (t < eng.t0 + IN) {
    const f = (t - eng.t0) / IN
    sampleSegs(s, eng.t0, TMP_ST)
    if (TMP_ST.mode !== 'gone') {
      st.pos[0] = TMP_ST.pos[0] + (st.pos[0] - TMP_ST.pos[0]) * f
      st.pos[1] = TMP_ST.pos[1] + (st.pos[1] - TMP_ST.pos[1]) * f
      st.pos[2] = TMP_ST.pos[2] + (st.pos[2] - TMP_ST.pos[2]) * f
    }
  } else if (t > eng.t1 - IN) {
    const f = (eng.t1 - t) / IN
    sampleSegs(s, eng.t1, TMP_ST)
    if (TMP_ST.mode !== 'gone') {
      st.pos[0] = TMP_ST.pos[0] + (st.pos[0] - TMP_ST.pos[0]) * f
      st.pos[1] = TMP_ST.pos[1] + (st.pos[1] - TMP_ST.pos[1]) * f
      st.pos[2] = TMP_ST.pos[2] + (st.pos[2] - TMP_ST.pos[2]) * f
    }
  }
}

function sampleSegs(s: Soldier, t: number, st: SoldierState): void {
  const first = s.segs[0]
  if (t < first.t0) {
    st.mode = 'gone'
    return
  }
  for (const seg of s.segs) {
    if (t <= seg.t1) {
      const f = seg.t1 > seg.t0 ? (t - seg.t0) / (seg.t1 - seg.t0) : 1
      const x = seg.ax + (seg.bx - seg.ax) * f
      const z = seg.az + (seg.bz - seg.az) * f
      let y = seg.ay + (seg.by - seg.ay) * f
      if (seg.zip) {
        y += Math.sin(f * Math.PI) * 7 // cable arc bulge
        st.mode = 'zip'
        st.anchor[0] = seg.bx
        st.anchor[1] = seg.by + 26
        st.anchor[2] = seg.bz
        st.speed = 8
      } else {
        st.mode = 'stand'
        st.anchor[1] = -1
        st.speed = 0.5
      }
      st.pos[0] = x
      st.pos[1] = y
      st.pos[2] = z
      st.yaw = Math.atan2(seg.bx - seg.ax, seg.bz - seg.az)
      return
    }
  }
  const last = s.segs[s.segs.length - 1]
  st.mode = 'stand'
  st.pos[0] = last.bx
  st.pos[1] = last.by
  st.pos[2] = last.bz
  st.anchor[1] = -1
  st.speed = 0.5
}

// ---------------------------------------------------------------------------
// static event exports (Gore / Fires / Soldiers effects)
// ---------------------------------------------------------------------------
import type { FireSpot, KillEvent } from './ep1'

/** civilian bites + soldier deaths, for the gore systems */
export const EP2_KILL_EVENTS: KillEvent[] = [
  ...PEOPLE.filter((p) => p.grabT !== undefined && p.grabT + 1.6 <= EP2_DURATION).map((p) => ({
    t: p.grabT! + 1.6,
    x: p.grabX!,
    z: p.grabZ!,
    mouthY: (p.titanHeight ?? 8) * 0.86,
  })),
  ...SOLDIERS.filter((s) => s.deathT !== undefined).map((s) => {
    const st: SoldierState = { pos: [0, 0, 0], yaw: 0, mode: 'zip', anchor: [0, -1, 0], speed: 0 }
    sampleSoldierAlive(s, s.deathT!, st)
    return { t: s.deathT!, x: st.pos[0], z: st.pos[2], mouthY: Math.max(4, st.pos[1]) }
  }),
]

// fires stay OFF the main street (|x|<45) — the director cam backs down it
// during the boulder carry and a flame against the lens whites out the shot
export const EP2_FIRE_SPOTS: FireSpot[] = [
  ...Array.from({ length: 10 }, (_, k) => ({
    x: (k % 2 === 0 ? 1 : -1) * range(rand, 45, 260),
    z: OUTER.z - range(rand, 50, 380),
    t0: T_BREACH + 3 + k * 3 + range(rand, 0, 2),
    scale: range(rand, 0.7, 1.5),
  })),
  // breach markers: rubble fires flanking the broken gate so the destination
  // of the boulder carry is unmistakable (the intact inner gate has none)
  { x: 34, z: OUTER.z - 26, t0: T_BREACH + 1.2, scale: 1.15 },
  { x: -38, z: OUTER.z - 40, t0: T_BREACH + 2.2, scale: 0.95 },
]

import type { TitanTrack } from './ep1'

/** every titan's footprint over time — buildings in the way get crushed */
export const EP2_TITAN_TRACKS: TitanTrack[] = (() => {
  const tracks: TitanTrack[] = []
  for (const pt of PURE_TITANS) {
    const end = Math.min(pt.deathT ?? EP2_DURATION, EP2_DURATION)
    let lx = Infinity
    let lz = Infinity
    for (let t = pt.spawnT; t <= end; t += 0.5) {
      const s = sampleKeyframes(pt.frames, t)
      if (Math.hypot(s.x - lx, s.z - lz) < 1.5) continue
      tracks.push({ t, x: s.x, z: s.z, r: Math.max(2.4, pt.height * 0.3) })
      lx = s.x
      lz = s.z
    }
    if (pt.deathT !== undefined) {
      // the body comes down hard — flattens whatever it lands on
      const s = sampleKeyframes(pt.frames, pt.deathT)
      tracks.push({
        t: pt.deathT + 0.7,
        x: s.x - Math.sin(s.yaw) * pt.height * 0.35,
        z: s.z - Math.cos(s.yaw) * pt.height * 0.35,
        r: pt.height * 0.42,
      })
    }
  }
  // the rogue at a sprint
  for (let t = T_ERUPT + 2.2; t <= T_SLAM; t += 0.35) {
    const s = sampleKeyframes(ROGUE_PATH, t)
    if (!s.moving) continue
    tracks.push({ t, x: s.x, z: s.z, r: 4.4 })
  }
  return tracks
})()

/** rogue punch impacts — camera low-angles + debris/dust/blood bursts */
export const EP2_PUNCHES = PUNCHES.map((p) => ({
  t: p.t,
  x: p.x,
  z: p.z,
  h: PURE_TITANS[p.titan].height,
}))

/** rogue footfalls while sprinting/carrying — dust kicks + ground thumps */
export const EP2_ROGUE_STEPS: { t: number; x: number; z: number }[] = (() => {
  const steps: { t: number; x: number; z: number }[] = []
  for (let t = T_ERUPT + 2.2; t <= T_SLAM; t += 0.55) {
    const s = sampleKeyframes(ROGUE_PATH, t)
    if (!s.moving) continue
    steps.push({ t, x: s.x, z: s.z })
  }
  return steps
})()

/** ride-along windows for the director cam: follow this soldier vs this titan.
 * Window 2 covers the boulder lift — the escort fight where soldier 18 dies. */
export const EP2_ENGAGE_SHOTS = [
  { t0: 21.8, t1: 28.4, soldier: 0, titan: 2 },
  { t0: T_LIFT + 0.6, t1: Math.min(68.2, T_CARRY + 5), soldier: 18, titan: 9 },
]

export interface FlareEvent {
  t0: number
  x: number
  z: number
  color: 'red' | 'green' | 'yellow'
}

/** signal flares — rendered by the soldier layer */
export const FLARE_EVENTS: FlareEvent[] = [
  { t0: 16, x: 30, z: OUTER.z - 90, color: 'red' },
  { t0: 24, x: -90, z: GATE.z + 340, color: 'red' },
  { t0: 40.5, x: 60, z: GATE.z + 260, color: 'yellow' },
  { t0: T_LIFT - 2, x: BOULDER_REST[0], z: BOULDER_REST[2], color: 'green' },
  { t0: T_SEALED + 1.5, x: 0, z: OUTER.z - 80, color: 'yellow' },
]

/** nape-cut kill flashes (green-white spark at the nape) */
export const NAPE_EVENTS = NAPE_KILLS.map((nk) => {
  const at = sampleKeyframes(PURE_TITANS[nk.titan].frames, nk.t)
  return { t: nk.t, x: at.x, z: at.z, y: PURE_TITANS[nk.titan].height * 0.88 }
})

export const EP2_SOLDIER_COUNT = SOLDIERS.length

/** where the Rogue Titan tears out of the bearded titan (director cam + FX) */
export const EP2_ERUPT = { x: ERUPT_AT.x, z: ERUPT_AT.z, t: T_ERUPT }
export const EP2_T_SLAM = T_SLAM
export const EP2_T_LIFT = T_LIFT
export const EP2_T_CARRY = T_CARRY

// ---------------------------------------------------------------------------
// preallocated frame
// ---------------------------------------------------------------------------
const personStates: PersonState[] = PEOPLE.map(() => ({
  pos: [0, 0, 0] as Vec3,
  yaw: 0,
  mode: 'calm',
  speed: 0,
}))

const soldierStates: SoldierState[] = SOLDIERS.map(() => ({
  pos: [0, 0, 0] as Vec3,
  yaw: 0,
  mode: 'gone',
  anchor: [0, -1, 0] as Vec3,
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
  id: 'colossal-trost',
  kind: 'colossal',
  height: 60,
  pos: [0, 0, OUTER.z + 28],
  yaw: Math.PI,
  walkSpeed: 0,
  eating: 0,
  crouch: 0,
  down: 0,
  steam: 0,
  attack: 0,
  carry: 0,
  visible: false,
}

const rogueState: TitanState = {
  id: 'rogue',
  kind: 'rogue',
  height: ROGUE_H,
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

const boulderState: BoulderState = {
  pos: [...BOULDER_REST] as Vec3,
  held: false,
  sealed: false,
  visible: true,
}

const frame: IncidentFrame = {
  active: false,
  id: null,
  t: 0,
  duration: EP2_DURATION,
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
  soldiers: soldierStates,
  boulder: boulderState,
  deaths: 0,
  soldiersLost: 0,
  titansSlain: 0,
  caption: null,
  endCard: false,
  victory: false,
}

// ---------------------------------------------------------------------------
const CAPTIONS: [number, number, string][] = [
  [0.5, 7.5, 'Trost District — Year 850. Five years since the fall of Wall Maria.'],
  [8.4, 13, 'It is back. The Colossal Titan, at the gate, again.'],
  [14.5, 19, 'The gate is breached. But this time, humanity does not run.'],
  [20, 25.5, 'The Garrison engages. Cables, blades, and one weak spot: the nape.'],
  [26.5, 31.5, 'Cadet Squad 34 takes the vanguard. It does not go well.'],
  [32.2, 36.5, 'Eren Yeager is swallowed whole. His story should end here.'],
  [38.6, 43, 'A titan TEARS ITS WAY OUT of the titan. And it is furious.'],
  [44, 49.5, 'It ignores the humans. It only hunts its own kind.'],
  [51, 57, 'The Rogue Titan — fifteen meters of fury, fighting for us.'],
  [T_LIFT - 1.5, T_CARRY + 0.5, 'The plan: one boulder, one hole, one chance. Protect him.'],
  [T_CARRY + 2, T_SLAM - 1.5, 'Soldiers die buying every meter of the carry.'],
  [T_SLAM + 1.2, T_SLAM + 5.5, 'THE GATE IS SEALED.'],
  [T_SLAM + 7, T_ENDCARD - 1, 'From the nape they cut out a boy. Alive. Humanity has a weapon.'],
]

/** canon aftermath, per the Attack on Titan wiki — rendered on the end card */
export const EP2_AFTERMATH = [
  'The first victory over the Titans in one hundred years.',
  'The cost: 207 soldiers dead or missing. 897 wounded.',
  'And in the nape of the titan that sealed the gate: a boy, Eren Yeager. Humanity finally has a weapon.',
]

function decay(since: number, peak: number, halflife: number): number {
  if (since < 0) return 0
  return peak * Math.exp(-since / halflife)
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

// ---------------------------------------------------------------------------
export function evalEp2(t: number, active: boolean): IncidentFrame {
  frame.active = active
  frame.id = active ? 'ep2' : null
  frame.t = t
  frame.endCard = active && t >= T_ENDCARD
  frame.victory = active && t >= T_SEALED

  frame.flash =
    (t >= T_FLASH ? Math.max(0, 1 - (t - T_FLASH) / 0.5) : 0) +
    (t >= T_ERUPT ? Math.max(0, 0.85 - (t - T_ERUPT) / 0.45) : 0)

  let shake =
    decay(t - T_BREACH, 0.9, 0.9) +
    decay(t - T_ERUPT, 0.8, 0.8) +
    decay(t - T_SLAM, 1.6, 1.1)
  for (const p of PUNCHES) shake += decay(t - p.t, 0.6, 0.55)
  // fifteen meters of muscle hitting the ground — every stride thumps
  if (t >= T_ERUPT + 2.2 && t < T_LIFT - 1) shake += 0.09 * Math.abs(Math.sin(t * 5.6))
  if (t >= T_CARRY && t < T_SLAM) shake += 0.14 * Math.abs(Math.sin(t * 2.7))
  frame.shake = shake

  // day-battle grading: grim after the breach, releasing after the seal
  const rise = clamp01((t - T_BREACH) / 12) * 0.85
  const release = clamp01((t - T_SEALED) / 8) * 0.5
  frame.atmosphere = active ? Math.max(0, rise - release) + (t >= T_FLASH && t < T_BREACH ? 0.15 : 0) : 0

  // gates — outer only; the inner gate holds
  frame.outerGateBroken = t >= T_BREACH
  frame.outerGateAge = frame.outerGateBroken ? t - T_BREACH : -1
  frame.innerGateBroken = false
  frame.innerGateAge = -1

  // colossal: appears, kicks, gone in steam almost immediately (canon)
  if (t >= T_FLASH && t < T_VANISH + 2.5) {
    colossalState.visible = t < T_VANISH + 1.2
    if (t >= T_KICK_START && t < T_BREACH + 0.8) {
      const f = (t - T_KICK_START) / (T_BREACH + 0.8 - T_KICK_START)
      colossalState.crouch = Math.sin(f * Math.PI)
    } else {
      colossalState.crouch = 0
    }
    frame.colossal = colossalState
    frame.colossalSteam = t >= T_VANISH ? Math.min(1, (t - T_VANISH) / 1.5) : t > 9 ? 0.25 : 0
  } else {
    frame.colossal = null
    frame.colossalSteam = 0
  }
  frame.armored = null

  // rogue titan
  if (active && t >= T_ERUPT) {
    const s = sampleKeyframes(ROGUE_PATH, t)
    rogueState.pos[0] = s.x
    rogueState.pos[2] = s.z
    rogueState.yaw = s.yaw
    rogueState.walkSpeed = s.moving ? (t >= T_CARRY && t < T_SLAM ? 6 : ROGUE_SPEED * 2.2) : 0
    rogueState.visible = true
    // birth: rise out of the carcass
    const birth = clamp01((t - T_ERUPT) / 1.6)
    rogueState.pos[1] = (birth - 1) * ROGUE_H * 0.35
    // roar right after birth, and again when the gate seals
    rogueState.eating = 0
    rogueState.crouch =
      t < T_ERUPT + 2.2 ? Math.sin(clamp01((t - T_ERUPT - 0.4) / 1.8) * Math.PI) * 0.4 : 0
    // punches
    rogueState.attack = 0
    for (const p of PUNCHES) {
      if (t >= p.t - 0.45 && t <= p.t + 0.45) rogueState.attack = (t - (p.t - 0.45)) / 0.9
    }
    // boulder work
    if (t >= T_LIFT && t < T_CARRY) rogueState.crouch = Math.sin(clamp01((t - T_LIFT) / (T_CARRY - T_LIFT)) * Math.PI) * 0.75
    rogueState.carry = t >= T_LIFT ? (t < T_SLAM ? clamp01((t - T_LIFT) / 2.4) : Math.max(0, 1 - (t - T_SLAM) / 0.8)) : 0
    if (t >= T_SLAM - 0.3 && t <= T_SLAM + 0.6) rogueState.attack = clamp01((t - (T_SLAM - 0.3)) / 0.9)
    // aftermath: kneel and steam
    if (t >= T_SLAM + 2) {
      rogueState.crouch = clamp01((t - T_SLAM - 2) / 2) * 0.85
      rogueState.steam = clamp01((t - T_SLAM - 3) / 6) * 0.6
    } else if (t < T_LIFT) {
      rogueState.steam = 0.12 // always simmering
    }
    frame.rogue = rogueState
  } else {
    rogueState.visible = false
    frame.rogue = null
  }

  // pures
  let slain = 0
  for (let i = 0; i < PURE_TITANS.length; i++) {
    const pt = PURE_TITANS[i]
    const st = pureStates[i]
    if (!active || t < pt.spawnT) {
      st.visible = false
      st.down = 0
      st.steam = 0
      continue
    }
    const dead = pt.deathT !== undefined && t >= pt.deathT
    const sampleT = dead ? pt.deathT! : t
    const s = sampleKeyframes(pt.frames, sampleT)
    st.pos[0] = s.x
    st.pos[2] = s.z
    st.yaw = s.yaw
    st.walkSpeed = dead || !s.moving ? 0 : 3.5 + pt.height * 0.45
    st.eating = 0
    if (!dead) {
      for (const eat of pt.eats) {
        if (t >= eat.start && t <= eat.end) st.eating = (t - eat.start) / (eat.end - eat.start)
      }
    }
    if (dead) {
      slain++
      const since = t - pt.deathT!
      const fast = pt.deathBy === 'eruption'
      st.down = clamp01(since / (fast ? 0.5 : 1.3))
      st.steam = clamp01((since - (fast ? 0.4 : 1.1)) / 5)
      st.visible = st.steam < 1
    } else {
      st.down = 0
      st.steam = 0
      st.visible = true
    }
  }
  frame.titansSlain = slain

  // civilians (same flee model as ep1, faster evacuation)
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
      const ph = p.loiterPhase + t * 0.35
      st.mode = 'calm'
      st.pos[0] = p.homeX + Math.cos(ph) * p.loiterR
      st.pos[1] = 0
      st.pos[2] = p.homeZ + Math.sin(ph) * p.loiterR * 0.6
      st.yaw = ph + Math.PI / 2
      st.speed = 0.8
      continue
    }
    const t0 = T_PANIC + p.fleeDelay
    const targetX = p.grabT !== undefined ? p.grabX! : GATE.x + (p.homeX % 13)
    const targetZ = p.grabT !== undefined ? p.grabZ! : GATE.z + 4
    const dx = targetX - p.homeX
    const dz = targetZ - p.homeZ
    const dist = Math.hypot(dx, dz)
    const arrive = p.grabT !== undefined ? p.grabT! : t0 + dist / p.fleeSpeed
    if (t >= arrive && p.grabT === undefined) {
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

  // soldiers
  let lost = 0
  for (let i = 0; i < SOLDIERS.length; i++) {
    const s = SOLDIERS[i]
    const st = soldierStates[i]
    if (!active) {
      st.mode = 'gone'
      continue
    }
    sampleSoldier(s, t, st)
    if (s.deathT !== undefined && t >= s.deathT) lost++
  }
  frame.soldiersLost = lost

  // boulder
  boulderState.visible = active
  boulderState.sealed = t >= T_SEALED
  boulderState.held = t >= T_CARRY - 0.4 && t < T_SLAM
  if (t < T_LIFT) {
    boulderState.pos[0] = BOULDER_REST[0]
    boulderState.pos[1] = BOULDER_REST[1]
    boulderState.pos[2] = BOULDER_REST[2]
  } else if (t < T_SLAM) {
    // rising into the rogue's hands, then riding overhead
    const lift = clamp01((t - T_LIFT) / (T_CARRY - T_LIFT))
    const y = BOULDER_REST[1] + (ROGUE_H * 1.12 - BOULDER_REST[1]) * lift * lift
    boulderState.pos[0] = rogueState.pos[0]
    boulderState.pos[1] = y
    boulderState.pos[2] = rogueState.pos[2] + (1 - lift) * 2
  } else {
    // slammed into the breach
    const f = clamp01((t - T_SLAM) / 0.6)
    const fromY = ROGUE_H * 1.12
    boulderState.pos[0] = rogueState.pos[0] * (1 - f)
    boulderState.pos[1] = fromY + (9 - fromY) * f
    boulderState.pos[2] = (OUTER.z - 26) * (1 - f) + (OUTER.z - 2) * f
  }
  frame.boulder = boulderState

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

export const EP2_META = {
  id: 'ep2',
  title: 'The Battle of Trost',
  year: 850,
  duration: EP2_DURATION,
}
