import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import * as THREE from 'three'
import { useParadis } from '../state/store'
import { getFrame } from '../incidents/driver'
import { SHI_INNER_GATE, SHI_OUTER_GATE } from '../world/constants'

const FLY_DUR = 2.4
const GZ = SHI_INNER_GATE[2] // 12000 — inner gate through Wall Maria
const OZ = SHI_OUTER_GATE[2] // 12550 — outer district gate

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

const SHOTS: Shot[] = [
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

function evalDirector(t: number, pos: THREE.Vector3, tgt: THREE.Vector3) {
  for (const s of SHOTS) {
    if (t >= s.t0 && t < s.t1) {
      const span = Math.min(s.t1 - s.t0, 12)
      s.eval(smootherstep((t - s.t0) / span), pos, tgt)
      return
    }
  }
  SHOTS[SHOTS.length - 1].eval(1, pos, tgt)
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
      evalDirector(getFrame().t, V, controls.current.target)
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
