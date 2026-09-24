// Impact FX for Episode 2 (Battle of Trost) — the visceral layer over the
// rogue's rampage. EVERYTHING is a pure function of the incident frame time
// (frame.t) so scrubbing forward AND backward is exact: no accumulating
// particle state, no wall-clock, all randomness seeded at module init.
//
// Two event sources, gated on frame.id === 'ep2':
//   1. rogue punches (EP2_PUNCHES) — for each: an expanding ground dust ring,
//      seeded debris chunks on ballistic arcs, and a red titan-blood mist burst
//      at nape height. Blood is UNLIT (lit dark crimson reads black under the
//      episode grading — same reasoning as Gore.tsx).
//   2. rogue footfalls (EP2_ROGUE_STEPS) — a small ground dust kick per step.
//
// Four instanced systems, each an InstancedMesh sized to its full event set.
// Hidden instances collapse to scale 0 at y=-1000. Zero per-frame allocation.

import { useMemo, useRef, useLayoutEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  DoubleSide,
  IcosahedronGeometry,
  InstancedMesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  RingGeometry,
} from 'three'
import { getFrame } from '../incidents/driver'
import { mulberry32 } from '../world/rng'
import { EP2_PUNCHES, EP2_ROGUE_STEPS } from '../incidents/ep2'

// ---------------------------------------------------------------------------
// module-scope scratch — reused every frame, never reallocated
// ---------------------------------------------------------------------------
const dummy = new Object3D()
const scratchColor = new Color()
const HIDDEN_Y = -1000

function hide(mesh: InstancedMesh, i: number) {
  dummy.position.set(0, HIDDEN_Y, 0)
  dummy.scale.set(0, 0, 0)
  dummy.rotation.set(0, 0, 0)
  dummy.updateMatrix()
  mesh.setMatrixAt(i, dummy.matrix)
}

// soft round particle texture (see Soldiers.tsx PUFF_TEX) — without it, sprites
// on billboarded quads render as hard squares.
const PUFF_TEX = (() => {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.5, 'rgba(255,255,255,0.5)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  return new CanvasTexture(c)
})()

// ---------------------------------------------------------------------------
// tuning
// ---------------------------------------------------------------------------
const PUNCH_LIFE = 1.4 // window each punch's FX are live
const RING_MAX_R = 14 // ground dust ring final radius
const DEBRIS_PER_PUNCH = 8 // ballistic rubble chunks
const DEBRIS_GRAVITY = 26 // m/s^2
const MIST_PER_PUNCH = 12 // red blood droplets
const MIST_GRAVITY = 18
const MIST_LIFE = 1.1

const STEP_LIFE = 0.9 // window each footfall dust puff is live
const PUFFS_PER_STEP = 3

const DUST_COLOR = 0x9c8f78 // grey-tan pulverized masonry
const BLOOD_TONES = [0x9a1414, 0xa81c1c, 0x8c1010, 0xb52222] // titan blood, unlit

// ---------------------------------------------------------------------------
// deterministic per-event descriptors, seeded once at mount
// ---------------------------------------------------------------------------
interface Debris {
  vx: number
  vy: number
  vz: number
  size: number
  spin: number
}
interface Droplet {
  ox: number
  oy: number
  oz: number
  vx: number
  vy: number
  vz: number
  size: number
  color: Color
}
interface PunchFX {
  debris: Debris[]
  mist: Droplet[]
}
interface StepPuff {
  ox: number
  oz: number
  size: number
  drift: number
}

function buildPunches(): PunchFX[] {
  return EP2_PUNCHES.map((_, i) => {
    const rand = mulberry32(0x9001 + i)
    const debris: Debris[] = []
    for (let k = 0; k < DEBRIS_PER_PUNCH; k++) {
      const az = rand() * Math.PI * 2
      const el = 0.5 + rand() * 0.7 // biased upward
      const spd = 9 + rand() * 12
      debris.push({
        vx: Math.cos(az) * Math.cos(el) * spd,
        vy: Math.sin(el) * spd + 4,
        vz: Math.sin(az) * Math.cos(el) * spd,
        size: 0.5 + rand() * 1.1,
        spin: (rand() - 0.5) * 10,
      })
    }
    const mist: Droplet[] = []
    for (let k = 0; k < MIST_PER_PUNCH; k++) {
      const az = rand() * Math.PI * 2
      const el = rand() * 0.9 + 0.05
      const spd = 5 + rand() * 10
      const dir = Math.cos(el)
      mist.push({
        ox: (rand() - 0.5) * 1.2,
        oy: (rand() - 0.5) * 1.2,
        oz: (rand() - 0.5) * 1.2,
        vx: Math.cos(az) * dir * spd,
        vy: Math.sin(el) * spd + 3,
        vz: Math.sin(az) * dir * spd,
        size: 0.5 + rand() * 1.0,
        color: new Color(BLOOD_TONES[Math.floor(rand() * BLOOD_TONES.length)]),
      })
    }
    return { debris, mist }
  })
}

function buildStepPuffs(): StepPuff[] {
  const out: StepPuff[] = []
  for (let i = 0; i < EP2_ROGUE_STEPS.length; i++) {
    const rand = mulberry32(0x5a00 + i)
    for (let k = 0; k < PUFFS_PER_STEP; k++) {
      out.push({
        ox: (rand() - 0.5) * 5,
        oz: (rand() - 0.5) * 5,
        size: 3 + rand() * 3,
        drift: rand() * Math.PI * 2,
      })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
export function Impacts() {
  const ringRef = useRef<InstancedMesh>(null)
  const debrisRef = useRef<InstancedMesh>(null)
  const mistRef = useRef<InstancedMesh>(null)
  const stepRef = useRef<InstancedMesh>(null)

  const punches = useMemo(() => buildPunches(), [])
  const stepPuffs = useMemo(() => buildStepPuffs(), [])

  const PUNCH_COUNT = EP2_PUNCHES.length
  const DEBRIS_COUNT = PUNCH_COUNT * DEBRIS_PER_PUNCH
  const MIST_COUNT = PUNCH_COUNT * MIST_PER_PUNCH
  const STEP_COUNT = stepPuffs.length

  // ---- geometries ----
  const ringGeo = useMemo(() => {
    const g = new RingGeometry(0.72, 1, 40)
    g.rotateX(-Math.PI / 2) // lie flat on the ground
    return g
  }, [])
  const debrisGeo = useMemo(() => new IcosahedronGeometry(1, 0), [])
  const mistGeo = useMemo(() => new PlaneGeometry(1, 1), [])
  const stepGeo = useMemo(() => new PlaneGeometry(1, 1), [])

  // ---- materials ----
  const ringMat = useMemo(
    () =>
      new MeshBasicMaterial({
        color: DUST_COLOR,
        map: PUFF_TEX,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        side: DoubleSide,
        toneMapped: false,
      }),
    [],
  )
  const debrisMat = useMemo(() => new MeshBasicMaterial({ color: DUST_COLOR, toneMapped: false }), [])
  // unlit blood — lit dark crimson reads as black under the episode grading
  const mistMat = useMemo(
    () =>
      new MeshBasicMaterial({
        map: PUFF_TEX,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        side: DoubleSide,
        toneMapped: false,
      }),
    [],
  )
  const stepMat = useMemo(
    () =>
      new MeshBasicMaterial({
        color: DUST_COLOR,
        map: PUFF_TEX,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
        side: DoubleSide,
        toneMapped: false,
      }),
    [],
  )

  // bake per-droplet blood colours once (they don't change)
  useLayoutEffect(() => {
    const mi = mistRef.current
    if (!mi) return
    let idx = 0
    for (let p = 0; p < punches.length; p++) {
      for (let k = 0; k < punches[p].mist.length; k++) {
        mi.setColorAt(idx, punches[p].mist[k].color)
        idx++
      }
    }
    if (mi.instanceColor) mi.instanceColor.needsUpdate = true
  }, [punches])

  useFrame((state) => {
    const frame = getFrame()
    const active = frame.id === 'ep2'
    const t = frame.t
    const camPos = state.camera.position

    const rm = ringRef.current
    const dbm = debrisRef.current
    const mm = mistRef.current
    const spm = stepRef.current
    if (!rm || !dbm || !mm || !spm) return

    // -------------------------------------------------------------------
    // 1. punch ground dust rings — expand outward, fade
    // -------------------------------------------------------------------
    for (let p = 0; p < PUNCH_COUNT; p++) {
      const ev = EP2_PUNCHES[p]
      const age = active ? t - ev.t : -1
      if (age < 0 || age > PUNCH_LIFE) {
        hide(rm, p)
        continue
      }
      const life = age / PUNCH_LIFE // 0..1
      // fade in fast, out slow; radius grows outward the whole window
      const alpha = (1 - life) * (life < 0.15 ? life / 0.15 : 1)
      // encode alpha into radius so a shared-opacity material still reads as fade
      const r = (2 + life * RING_MAX_R) * (0.5 + alpha * 0.5)
      dummy.position.set(ev.x, 0.15, ev.z)
      dummy.rotation.set(0, 0, 0)
      dummy.scale.set(r, 1, r) // ring lies in X/Z; Y is unused (flat)
      dummy.updateMatrix()
      rm.setMatrixAt(p, dummy.matrix)
    }
    rm.instanceMatrix.needsUpdate = true

    // -------------------------------------------------------------------
    // 2. punch debris chunks — ballistic arcs from the impact point
    // -------------------------------------------------------------------
    let di = 0
    for (let p = 0; p < PUNCH_COUNT; p++) {
      const ev = EP2_PUNCHES[p]
      const age = active ? t - ev.t : -1
      const alive = age >= 0 && age <= PUNCH_LIFE
      const fx = punches[p]
      for (let k = 0; k < fx.debris.length; k++) {
        if (!alive) {
          hide(dbm, di)
          di++
          continue
        }
        const d = fx.debris[k]
        const px = ev.x + d.vx * age
        const py = ev.h * 0.2 + d.vy * age - 0.5 * DEBRIS_GRAVITY * age * age
        const pz = ev.z + d.vz * age
        dummy.position.set(px, Math.max(0.2, py), pz)
        dummy.rotation.set(d.spin * age, d.spin * age * 0.6, d.spin * age * 0.3)
        dummy.scale.setScalar(d.size)
        dummy.updateMatrix()
        dbm.setMatrixAt(di, dummy.matrix)
        di++
      }
    }
    dbm.instanceMatrix.needsUpdate = true

    // -------------------------------------------------------------------
    // 3. punch blood mist — red droplets at nape height, ballistic, unlit
    // -------------------------------------------------------------------
    let mi = 0
    for (let p = 0; p < PUNCH_COUNT; p++) {
      const ev = EP2_PUNCHES[p]
      const age = active ? t - ev.t : -1
      const alive = age >= 0 && age <= MIST_LIFE
      const burstY = ev.h * 0.55
      const fx = punches[p]
      for (let k = 0; k < fx.mist.length; k++) {
        if (!alive) {
          hide(mm, mi)
          mi++
          continue
        }
        const dp = fx.mist[k]
        const px = ev.x + dp.ox + dp.vx * age
        const py = burstY + dp.oy + dp.vy * age - 0.5 * MIST_GRAVITY * age * age
        const pz = ev.z + dp.oz + dp.vz * age
        const life = 1 - age / MIST_LIFE
        const s = dp.size * (0.5 + life * 0.7)
        dummy.position.set(px, Math.max(0.1, py), pz)
        dummy.lookAt(camPos.x, camPos.y, camPos.z)
        dummy.scale.setScalar(Math.max(0, s) * (0.3 + life * 0.7))
        dummy.updateMatrix()
        mm.setMatrixAt(mi, dummy.matrix)
        mi++
      }
    }
    mm.instanceMatrix.needsUpdate = true

    // -------------------------------------------------------------------
    // 4. footfall dust kicks — small billboarded puffs at ground level
    // -------------------------------------------------------------------
    let si = 0
    for (let s = 0; s < EP2_ROGUE_STEPS.length; s++) {
      const ev = EP2_ROGUE_STEPS[s]
      const age = active ? t - ev.t : -1
      const alive = age >= 0 && age <= STEP_LIFE
      for (let k = 0; k < PUFFS_PER_STEP; k++) {
        if (!alive) {
          hide(spm, si)
          si++
          continue
        }
        const pf = stepPuffs[si]
        const life = age / STEP_LIFE // 0..1
        const climb = 1 - (1 - life) * (1 - life)
        const y = 0.5 + climb * 3.5
        const spread = 1 + climb * 3
        const wx = ev.x + pf.ox + Math.cos(pf.drift) * spread
        const wz = ev.z + pf.oz + Math.sin(pf.drift) * spread
        const alpha = (1 - life) * Math.min(1, life / 0.15)
        const size = pf.size * (0.6 + climb * 1.1)
        dummy.position.set(wx, y, wz)
        dummy.lookAt(camPos.x, camPos.y, camPos.z)
        dummy.scale.setScalar(size * (0.2 + alpha))
        dummy.updateMatrix()
        spm.setMatrixAt(si, dummy.matrix)
        si++
      }
    }
    spm.instanceMatrix.needsUpdate = true
  })

  return (
    <group>
      {/* punch ground dust rings */}
      <instancedMesh ref={ringRef} args={[ringGeo, ringMat, PUNCH_COUNT]} frustumCulled={false} />
      {/* punch debris chunks */}
      <instancedMesh ref={debrisRef} args={[debrisGeo, debrisMat, DEBRIS_COUNT]} frustumCulled={false} />
      {/* punch blood mist */}
      <instancedMesh ref={mistRef} args={[mistGeo, mistMat, MIST_COUNT]} frustumCulled={false} />
      {/* footfall dust kicks */}
      <instancedMesh ref={stepRef} args={[stepGeo, stepMat, STEP_COUNT]} frustumCulled={false} />
    </group>
  )
}
