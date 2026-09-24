import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import * as THREE from 'three'
import { useParadis } from '../state/store'
import { getFrame } from '../incidents/driver'
import { SHI_INNER_GATE, SHI_OUTER_GATE, TRO_INNER_GATE, TRO_OUTER_GATE } from '../world/constants'
import {
  EP2_ERUPT,
  EP2_T_LIFT,
  EP2_T_CARRY,
  EP2_T_SLAM,
  EP2_ENGAGE_SHOTS,
  EP2_PUNCHES,
} from '../incidents/ep2'

const FLY_DUR = 2.4
const GZ = SHI_INNER_GATE[2] // 12000 — inner gate through Wall Maria
const OZ = SHI_OUTER_GATE[2] // 12550 — outer district gate
const GZ2 = TRO_INNER_GATE[2] // 9500 — inner gate through Wall Rose
const OZ2 = TRO_OUTER_GATE[2] // 10050 — Trost outer district gate

function smootherstep(x: number): number {
  const t = Math.min(1, Math.max(0, x))
  return t * t * t * (t * (t * 6 - 15) + 10)
}

// ---------------------------------------------------------------------------
// director cam — every shot is a pure function of incident time t, so the
// same scrub position always gives the same framing
// ---------------------------------------------------------------------------
interface Shot {
  t0: number
  t1: number
  eval: (f: number, pos: THREE.Vector3, tgt: THREE.Vector3) => void
}

const V = new THREE.Vector3()

function lerp3(out: THREE.Vector3, ax: number, ay: number, az: number, bx: number, by: number, bz: number, f: number) {
  out.set(ax + (bx - ax) * f, ay + (by - ay) * f, az + (bz - az) * f)
}

const SHOTS_EP1: Shot[] = [
  // 1 — slow drift over the rooftops, the gate in the distance. Calm before.
  {
    t0: 0,
    t1: 8,
    eval: (f, pos, tgt) => {
      lerp3(pos, 320, 170, GZ + 140, 130, 70, GZ + 300, f)
      tgt.set(0, 45, OZ)
    },
  },
  // 2 — THE reveal: street level, staring up as the head crests the wall. Kick lands.
  {
    t0: 8,
    t1: 16.5,
    eval: (f, pos, tgt) => {
      // street-level reveal. Sightline math: from y≈5 the 60m head only clears
      // the 50m wall when the camera is ≥185m back — hold there, don't dolly in
      lerp3(pos, 9, 5, OZ - 210, 5, 6, OZ - 188, f)
      lerp3(tgt, 0, 34, OZ, 0, 54, OZ + 16, f)
    },
  },
  // 3 — reverse from inside town: titans walking in through the torn gate
  {
    t0: 16.5,
    t1: 26,
    eval: (f, pos, tgt) => {
      lerp3(pos, -150, 36, OZ - 310, -95, 24, OZ - 270, f)
      tgt.set(0, 18, OZ - 20)
    },
  },
  // 4 — feeding ground: track the Smiling Titan as it hunts
  {
    t0: 26,
    t1: 36,
    eval: (_f, pos, tgt) => {
      const p = getFrame().pures[0]
      const h = p?.height ?? 10
      if (p?.visible) {
        // above the rooftops (gables reach ~12m) looking down at the feed
        tgt.set(p.pos[0], h * 0.55, p.pos[2])
        pos.set(p.pos[0] + 20, 17, p.pos[2] + 30)
      } else {
        tgt.set(0, 8, OZ - 260)
        pos.set(34, 24, OZ - 200)
      }
    },
  },
  // 5 — wide: the Colossal dissolves into steam over the broken gate
  {
    t0: 36,
    t1: 44,
    eval: (f, pos, tgt) => {
      lerp3(pos, 280, 130, GZ + 120, 340, 180, GZ + 60, f)
      tgt.set(0, 45, OZ + 10)
    },
  },
  // 6 — the crush at the inner gate, fires burning behind
  {
    t0: 44,
    t1: 54,
    eval: (f, pos, tgt) => {
      // down the main street toward the inner gate, fires burning either side
      lerp3(pos, 12, 9, GZ + 175, 7, 16, GZ + 105, f)
      tgt.set(0, 14, GZ)
    },
  },
  // 7 — running alongside the Armored Titan's charge
  {
    t0: 54,
    t1: 63.5,
    eval: (_f, pos, tgt) => {
      const a = getFrame().armored
      if (a?.visible) {
        tgt.set(a.pos[0], 10, a.pos[2])
        pos.set(a.pos[0] + 58, 15, a.pos[2] + 6)
      } else {
        tgt.set(60, 10, OZ - 180)
        pos.set(120, 18, OZ - 150)
      }
    },
  },
  // 8 — inside Wall Maria, staring at the inner gate as it explodes toward us
  {
    t0: 63.5,
    t1: 71,
    eval: (f, pos, tgt) => {
      lerp3(pos, 42, 14, GZ - 210, 58, 20, GZ - 250, f)
      tgt.set(0, 20, GZ)
    },
  },
  // 9 — the long pull-back over the burning district
  {
    t0: 71,
    t1: 1e9,
    eval: (f, pos, tgt) => {
      const k = smootherstep(Math.min(1, f))
      lerp3(pos, 160, 90, GZ - 320, 950, 760, GZ - 1500, k)
      lerp3(tgt, 0, 25, GZ + 300, 0, 60, GZ + 380, k)
    },
  },
]

// ---------------------------------------------------------------------------
// Episode 2 — The Battle of Trost
//
// Trost geography (all times DERIVED — never hardcode 63/66/77):
//   inner gate  z=9500 (GZ2)  — Wall Rose, INTACT all episode
//   outer gate  z=10050 (OZ2) — BREACHED at t≈14.2, this is what the boulder seals
// The rogue carries the boulder from z≈9730 toward the breach at +z, so the
// camera must sit BEHIND him (smaller z) to keep the smoking broken gate ahead.
// ---------------------------------------------------------------------------

// the two rubble-fire markers flanking the breach (placed so the destination
// reads as "the broken one") and the breach aim point itself
const BREACH: [number, number, number] = [0, 25, OZ2 - 10]

const ENGAGE_A = EP2_ENGAGE_SHOTS[0] // 21.8→28.4, Garrison's first nape kill
const ENGAGE_B = EP2_ENGAGE_SHOTS[1] // 66.6→72.4, escort fight during the lift

// ride-along: hold a slowly drifting side vantage that frames both the soldier's
// cable streaks and the titan's nape. Do NOT orbit with the soldier (nauseating).
function rideAlong(soldier: number, titan: number, f: number, pos: THREE.Vector3, tgt: THREE.Vector3) {
  const fr = getFrame()
  const s = fr.soldiers[soldier]
  const p = fr.pures[titan]
  if (!s || !p) {
    tgt.set(0, 12, OZ2 - 40)
    pos.set(30, 18, OZ2 - 90)
    return
  }
  const h = p.height ?? 10
  const napeY = h * 0.85
  // midpoint between soldier and the titan's nape — the fight, framed
  const mx = (s.pos[0] + p.pos[0]) * 0.5
  const my = (s.pos[1] + napeY) * 0.5 + 2
  const mz = (s.pos[2] + p.pos[2]) * 0.5
  tgt.set(mx, my, mz)
  // side vantage drifting slowly across the window (f drives a gentle arc so it
  // never locks to the orbiting soldier). Height clears the ~14m rooflines —
  // the fight is IN the town and a rooftop through the lens reads as a brown wall.
  const lateral = 26 - f * 5 // 26 → 21m, easing in
  pos.set(mx + lateral, Math.max(my + 9, 18), mz - 26 + f * 9)
}

const SHOTS_EP2: Shot[] = [
  // 1 — calm drift over Trost, the gate ahead
  {
    t0: 0,
    t1: 8,
    eval: (f, pos, tgt) => {
      lerp3(pos, 320, 170, GZ2 + 140, 130, 70, GZ2 + 300, f)
      tgt.set(0, 45, OZ2)
    },
  },
  // 2 — street-level reveal: the Colossal is BACK (≥185m or the wall hides the head)
  {
    t0: 8,
    t1: 16.5,
    eval: (f, pos, tgt) => {
      lerp3(pos, 9, 5, OZ2 - 210, 5, 6, OZ2 - 188, f)
      lerp3(tgt, 0, 34, OZ2, 0, 54, OZ2 + 16, f)
    },
  },
  // 3 — the Garrison answers: soldiers zipping past, titans in the breach
  {
    t0: 16.5,
    t1: ENGAGE_A.t0,
    eval: (f, pos, tgt) => {
      lerp3(pos, -150, 36, OZ2 - 310, -95, 24, OZ2 - 270, f)
      tgt.set(0, 18, OZ2 - 20)
    },
  },
  // 4 — RIDE-ALONG #1: on the cable with the Garrison's first nape kill (soldier
  //     orbits the titan; dive-cut at t=26). Human-scale combat, not miniatures.
  {
    t0: ENGAGE_A.t0,
    t1: ENGAGE_A.t1,
    eval: (f, pos, tgt) => rideAlong(ENGAGE_A.soldier, ENGAGE_A.titan, f, pos, tgt),
  },
  // 5 — squad wipe: track the bearded titan that takes Eren, into the eruption
  {
    t0: ENGAGE_A.t1,
    t1: 37,
    eval: (_f, pos, tgt) => {
      const p = getFrame().pures[1]
      const h = p?.height ?? 12
      if (p?.visible) {
        tgt.set(p.pos[0], h * 0.55, p.pos[2])
        pos.set(p.pos[0] + 20, 17, p.pos[2] + 30)
      } else {
        tgt.set(0, 8, OZ2 - 260)
        pos.set(34, 24, OZ2 - 200)
      }
    },
  },
  // 6 — the eruption, up close and low
  {
    t0: 37,
    t1: 41.5,
    eval: (_f, pos, tgt) => {
      tgt.set(EP2_ERUPT.x, 9, EP2_ERUPT.z)
      pos.set(EP2_ERUPT.x + 26, 9, EP2_ERUPT.z + 34)
    },
  },
  // 7 — the fistfight: LOW-ANGLE punch impacts (looking UP at 15m of muscle),
  //     wider sprint tracking between them. Runs until the lift begins.
  {
    t0: 41.5,
    t1: EP2_T_LIFT,
    eval: (_f, pos, tgt) => {
      const now = getFrame().t
      const r = getFrame().rogue
      // is a punch landing right now? (1.5s before → 1.2s after impact)
      let punch: { t: number; x: number; z: number; h: number } | null = null
      for (const p of EP2_PUNCHES) {
        if (now >= p.t - 1.5 && now <= p.t + 1.2) {
          punch = p
          break
        }
      }
      if (punch) {
        // LOW and CLOSE: just above the rooflines so the fight isn't hidden
        // behind houses, close enough that 15m of titan fills the frame
        tgt.set(punch.x, punch.h * 0.62, punch.z)
        const ang = punch.t // deterministic per-punch bearing so angles vary
        pos.set(punch.x + Math.cos(ang) * 48, 13, punch.z + Math.sin(ang) * 48)
      } else if (r?.visible) {
        // wider tracking shot of the rogue sprinting between kills
        tgt.set(r.pos[0], 9, r.pos[2])
        pos.set(r.pos[0] + 24, 19, r.pos[2] + 34)
      } else {
        tgt.set(EP2_ERUPT.x, 9, EP2_ERUPT.z)
        pos.set(EP2_ERUPT.x + 24, 19, EP2_ERUPT.z + 34)
      }
    },
  },
  // 8 — the lift, then cut to RIDE-ALONG #2: the escort fight raging while the
  //     rogue crouches at the boulder. Cut away to the carry at EP2_T_CARRY.
  {
    t0: EP2_T_LIFT,
    t1: EP2_T_CARRY,
    eval: (f, pos, tgt) => {
      const now = getFrame().t
      if (now >= ENGAGE_B.t0 && now <= ENGAGE_B.t1) {
        rideAlong(ENGAGE_B.soldier, ENGAGE_B.titan, f, pos, tgt)
        return
      }
      // brief beat on the rogue crouching to grab the boulder
      const r = getFrame().rogue
      if (r?.visible) {
        tgt.set(r.pos[0], 11, r.pos[2])
        pos.set(r.pos[0] + 26, 16, r.pos[2] - 40)
      } else {
        tgt.set(-150, 11, GZ2 + 230)
        pos.set(-124, 16, GZ2 + 190)
      }
    },
  },
  // 9 — THE CARRY (fixed): camera BEHIND the rogue (−z), the smoking broken
  //     outer gate dead ahead the whole march. He walks +z toward the breach;
  //     target blends from him toward BREACH so the destination reads correctly.
  {
    t0: EP2_T_CARRY,
    t1: EP2_T_SLAM,
    eval: (_f, pos, tgt) => {
      const r = getFrame().rogue
      const now = getFrame().t
      const k = smootherstep((now - EP2_T_CARRY) / Math.max(0.1, EP2_T_SLAM - EP2_T_CARRY))
      if (r?.visible) {
        // camera trails him on −z so his back, the boulder, and the breach beyond
        // are all in frame; never between the rogue and the breach facing back
        pos.set(r.pos[0] - 40, 21, r.pos[2] - 62)
        // aim from the rogue's upper body toward the breach as he closes on it
        tgt.set(
          r.pos[0] + (BREACH[0] - r.pos[0]) * k,
          14 + (BREACH[1] - 14) * k,
          r.pos[2] + 24 + (BREACH[2] - (r.pos[2] + 24)) * k,
        )
      } else {
        lerp3(pos, -190, 21, GZ2 + 200, -40, 21, OZ2 - 62, k)
        tgt.set(BREACH[0], BREACH[1], BREACH[2])
      }
    },
  },
  // 10 — the slam: from inside the town looking AT the outer gate, the rogue
  //      silhouetted against the breach as the boulder goes in
  {
    t0: EP2_T_SLAM,
    t1: EP2_T_SLAM + 7,
    eval: (f, pos, tgt) => {
      // dolly along the street toward the breach, low enough to catch the
      // silhouette against the smoking gap
      lerp3(pos, 46, 20, OZ2 - 200, 30, 16, OZ2 - 150, f)
      tgt.set(0, 22, OZ2)
    },
  },
  // 11 — victory pull-back over the held district
  {
    t0: EP2_T_SLAM + 7,
    t1: 1e9,
    eval: (f, pos, tgt) => {
      const k = smootherstep(Math.min(1, f))
      lerp3(pos, 150, 90, GZ2 + 200, 950, 720, GZ2 - 1400, k)
      lerp3(tgt, 0, 30, OZ2 - 150, 0, 60, OZ2 - 100, k)
    },
  },
]

const SHOTS_BY_ID: Record<string, Shot[]> = { ep1: SHOTS_EP1, ep2: SHOTS_EP2 }

function evalDirector(incident: string, t: number, pos: THREE.Vector3, tgt: THREE.Vector3) {
  const shots = SHOTS_BY_ID[incident] ?? SHOTS_EP1
  for (const s of shots) {
    if (t >= s.t0 && t < s.t1) {
      const span = Math.min(s.t1 - s.t0, 12)
      s.eval(smootherstep((t - s.t0) / span), pos, tgt)
      return
    }
  }
  shots[shots.length - 1].eval(1, pos, tgt)
}

export function CameraRig() {
  const controls = useRef<OrbitControlsImpl>(null)
  const camera = useThree((s) => s.camera)
  const fly = useRef<{
    t0: number
    fromPos: THREE.Vector3
    fromTarget: THREE.Vector3
    toPos: THREE.Vector3
    toTarget: THREE.Vector3
  } | null>(null)
  const clockRef = useRef(0)

  const flySeq = useParadis((s) => s.flySeq)
  useEffect(() => {
    if (flySeq === 0) return
    const f = useParadis.getState().flyTo
    if (!f || !controls.current) return
    fly.current = {
      t0: clockRef.current,
      fromPos: camera.position.clone(),
      fromTarget: controls.current.target.clone(),
      toPos: new THREE.Vector3(...f.position),
      toTarget: new THREE.Vector3(...f.target),
    }
  }, [flySeq, camera])

  // interacting with the CANVAS cancels a fly and breaks out of director cam
  // (clicks on HUD buttons must not — they land on DOM, not the canvas)
  useEffect(() => {
    const cancel = (e: Event) => {
      if (!(e.target instanceof HTMLCanvasElement)) return
      fly.current = null
      if (useParadis.getState().cinematic) useParadis.getState().setCinematic(false)
    }
    window.addEventListener('pointerdown', cancel)
    window.addEventListener('wheel', cancel)
    return () => {
      window.removeEventListener('pointerdown', cancel)
      window.removeEventListener('wheel', cancel)
    }
  }, [])

  useFrame(({ clock }) => {
    clockRef.current = clock.elapsedTime
    const s = useParadis.getState()

    // director cam owns the camera while an incident plays in cinematic mode
    if (s.cinematic && s.incident && controls.current) {
      fly.current = null
      evalDirector(s.incident, getFrame().t, V, controls.current.target)
      // V holds pos; blend gently so scrub jumps don't teleport-snap
      camera.position.lerp(V, 0.22)
      return
    }

    const f = fly.current
    if (f && controls.current) {
      const k = smootherstep((clock.elapsedTime - f.t0) / FLY_DUR)
      camera.position.lerpVectors(f.fromPos, f.toPos, k)
      controls.current.target.lerpVectors(f.fromTarget, f.toTarget, k)
      if (k >= 1) fly.current = null
    }
  })

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      target={[0, 0, 2000]}
      enableDamping
      dampingFactor={0.08}
      maxPolarAngle={1.52}
      minDistance={20}
      maxDistance={34000}
      zoomSpeed={1.1}
    />
  )
}
