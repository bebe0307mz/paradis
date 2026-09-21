// Blood & gore for Episode 1. EVERYTHING here is a pure function of the
// incident frame time (frame.t) so scrubbing forward AND backward is exact.
// No React state, no wall-clock: we read getFrame().t inside useFrame and drive
// every instance transform/colour from (frame.t - event.t).
//
// Three instanced systems, one InstancedMesh each, sized for ALL kill events:
//   1. red mist burst   — ~36 particles per kill, ballistic, life ~1.2s
//   2. ground splatter   — irregular blobs + streaks, fades in then PERSISTS
//   3. small remains     — a few dark lumps that appear at t+0.8
//
// Hidden instances are collapsed to scale 0 (before their event, or when the
// incident is inactive). All scratch objects are preallocated at module scope.

import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { getFrame } from '../incidents/driver.ts'
import { mulberry32 } from '../world/rng.ts'
import type { KillEvent } from '../incidents/ep1.ts'

// ---------------------------------------------------------------------------
// tuning
// ---------------------------------------------------------------------------
const MIST_PER_KILL = 36
const MIST_LIFE = 1.2
const MIST_GRAVITY = 22 // m/s^2 downward

const SPLAT_BLOBS = 5 // overlapping flattened circles per kill
const SPLAT_STREAKS = 3 // elongated streak ellipses per kill
const SPLAT_FADE_IN = 0.5
const SPLAT_FADE_DELAY = 0.3

const REMAINS_PER_KILL = 3
const REMAINS_DELAY = 0.8

// ---------------------------------------------------------------------------
// shared geometry / scratch (no per-frame allocation)
// ---------------------------------------------------------------------------
const TETRA = new THREE.TetrahedronGeometry(0.6)
const DISC = new THREE.CircleGeometry(1, 20)
const LUMP = new THREE.SphereGeometry(0.5, 8, 6)

const dummy = new THREE.Object3D()
const scratchColor = new THREE.Color()

// ---------------------------------------------------------------------------
// precomputed, deterministic per-event particle/blob descriptors
// ---------------------------------------------------------------------------
interface MistP {
  ox: number // spawn offset from mouth
  oy: number
  oz: number
  vx: number // initial velocity
  vy: number
  vz: number
  size: number
  color: THREE.Color
  spin: number
}

interface Blob {
  dx: number // ground offset from kill centre
  dz: number
  rx: number // ellipse radii
  rz: number
  rot: number
  color: THREE.Color
}

interface Lump {
  dx: number
  dz: number
  r: number
  color: THREE.Color
}

interface KillGore {
  t: number
  x: number
  z: number
  mouthY: number
  mist: MistP[]
  blobs: Blob[]
  lumps: Lump[]
}

const MIST_TONES = [0x7a1010, 0x8c1616, 0x981a1a, 0xa51f1f, 0x901414]
const SPLAT_TONES = [0x7c0b0b, 0x8c1010, 0x961313, 0xa11616]
const LUMP_TONES = [0x4a0808, 0x5a0c0a, 0x3e0606]

function buildKills(events: KillEvent[]): KillGore[] {
  return events.map((ev, i) => {
  const rand = mulberry32(1000 + i)
  const mist: MistP[] = []
  for (let k = 0; k < MIST_PER_KILL; k++) {
    // explode roughly outward+up from the mouth
    const az = rand() * Math.PI * 2
    const el = rand() * 0.9 + 0.05
    const spd = 4 + rand() * 11
    const dir = Math.cos(el)
    mist.push({
      ox: (rand() - 0.5) * 0.8,
      oy: (rand() - 0.5) * 0.8,
      oz: (rand() - 0.5) * 0.8,
      vx: Math.cos(az) * dir * spd,
      vy: Math.sin(el) * spd + 3,
      vz: Math.sin(az) * dir * spd,
      size: 0.18 + rand() * 0.42,
      color: new THREE.Color(MIST_TONES[Math.floor(rand() * MIST_TONES.length)]),
      spin: (rand() - 0.5) * 8,
    })
  }
  const blobs: Blob[] = []
  for (let k = 0; k < SPLAT_BLOBS; k++) {
    const r = 1.6 + rand() * 3.4 // 1.6–5m
    blobs.push({
      dx: (rand() - 0.5) * 4,
      dz: (rand() - 0.5) * 4,
      rx: r,
      rz: r * (0.7 + rand() * 0.5),
      rot: rand() * Math.PI,
      color: new THREE.Color(SPLAT_TONES[Math.floor(rand() * SPLAT_TONES.length)]),
    })
  }
  for (let k = 0; k < SPLAT_STREAKS; k++) {
    // elongated streaks flung out from the centre
    const az = rand() * Math.PI * 2
    const len = 2 + rand() * 3
    const reach = 1.5 + rand() * 3
    blobs.push({
      dx: Math.cos(az) * reach,
      dz: Math.sin(az) * reach,
      rx: len,
      rz: 0.3 + rand() * 0.5,
      rot: az,
      color: new THREE.Color(SPLAT_TONES[Math.floor(rand() * SPLAT_TONES.length)]),
    })
  }
  const lumps: Lump[] = []
  for (let k = 0; k < REMAINS_PER_KILL; k++) {
    lumps.push({
      dx: (rand() - 0.5) * 2.2,
      dz: (rand() - 0.5) * 2.2,
      r: 0.3 + rand() * 0.3, // 0.3–0.6m
      color: new THREE.Color(LUMP_TONES[Math.floor(rand() * LUMP_TONES.length)]),
    })
  }
    return { t: ev.t, x: ev.x, z: ev.z, mouthY: ev.mouthY, mist, blobs, lumps }
  })
}

// ---------------------------------------------------------------------------
export function Gore({ events, forId }: { events: KillEvent[]; forId: string }) {
  const KILLS = useMemo(() => buildKills(events), [events])
  const MIST_COUNT = KILLS.length * MIST_PER_KILL
  const SPLAT_COUNT = KILLS.length * (SPLAT_BLOBS + SPLAT_STREAKS)
  const LUMP_COUNT = KILLS.length * REMAINS_PER_KILL
  const mistRef = useRef<THREE.InstancedMesh>(null)
  const splatRef = useRef<THREE.InstancedMesh>(null)
  const lumpRef = useRef<THREE.InstancedMesh>(null)

  // materials — created once. Splatter needs polygonOffset to sit on the ground
  // without z-fighting, and its opacity is written per-instance via instanceColor
  // brightness, so we keep the material fully opaque and modulate colour instead.
  const mistMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        toneMapped: false,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
      }),
    [],
  )
  // unlit: the hell-grade lighting is dim, and lit dark-crimson reads as black.
  // Blood must stay readable, so it ignores the scene lights entirely.
  const splatMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        toneMapped: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
        depthWrite: false,
      }),
    [],
  )
  const lumpMat = useMemo(() => new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 }), [])

  useFrame(() => {
    const frame = getFrame()
    const mist = mistRef.current
    const splat = splatRef.current
    const lump = lumpRef.current
    if (!mist || !splat || !lump) return

    const active = frame.id === forId
    const t = frame.t

    // ---- red mist burst ------------------------------------------------
    let mi = 0
    for (let e = 0; e < KILLS.length; e++) {
      const kill = KILLS[e]
      const age = t - kill.t
      const alive = active && age >= 0 && age < MIST_LIFE
      for (let p = 0; p < kill.mist.length; p++) {
        const mp = kill.mist[p]
        if (!alive) {
          dummy.position.set(0, -1000, 0)
          dummy.scale.setScalar(0)
          dummy.rotation.set(0, 0, 0)
          dummy.updateMatrix()
          mist.setMatrixAt(mi, dummy.matrix)
          mi++
          continue
        }
        const px = kill.x + mp.ox + mp.vx * age
        const py = kill.mouthY + mp.oy + mp.vy * age - 0.5 * MIST_GRAVITY * age * age
        const pz = kill.z + mp.oz + mp.vz * age
        const life = 1 - age / MIST_LIFE
        const s = mp.size * life * (0.6 + life * 0.4)
        dummy.position.set(px, Math.max(0.02, py), pz)
        dummy.rotation.set(mp.spin * age, mp.spin * age * 0.7, 0)
        dummy.scale.setScalar(Math.max(0, s))
        dummy.updateMatrix()
        mist.setMatrixAt(mi, dummy.matrix)
        // darken as it dies
        scratchColor.copy(mp.color).multiplyScalar(0.5 + life * 0.5)
        mist.setColorAt(mi, scratchColor)
        mi++
      }
    }
    mist.instanceMatrix.needsUpdate = true
    if (mist.instanceColor) mist.instanceColor.needsUpdate = true

    // ---- ground splatter (persists) ------------------------------------
    let si = 0
    for (let e = 0; e < KILLS.length; e++) {
      const kill = KILLS[e]
      const age = t - kill.t
      // fades in from t+0.3 over 0.5s, then stays for the rest of the episode
      const shown = active && age >= SPLAT_FADE_DELAY
      const fade = shown ? Math.min(1, (age - SPLAT_FADE_DELAY) / SPLAT_FADE_IN) : 0
      // very slow darkening as blood dries over the remaining timeline
      const dry = shown ? Math.max(0.55, 1 - (age - SPLAT_FADE_DELAY) * 0.006) : 1
      for (let b = 0; b < kill.blobs.length; b++) {
        const bl = kill.blobs[b]
        if (!shown) {
          dummy.position.set(0, -1000, 0)
          dummy.scale.setScalar(0)
          dummy.rotation.set(-Math.PI / 2, 0, 0)
          dummy.updateMatrix()
          splat.setMatrixAt(si, dummy.matrix)
          si++
          continue
        }
        dummy.position.set(kill.x + bl.dx, 0.05, kill.z + bl.dz)
        dummy.rotation.set(-Math.PI / 2, 0, bl.rot)
        dummy.scale.set(bl.rx * fade, bl.rz * fade, 1)
        dummy.updateMatrix()
        splat.setMatrixAt(si, dummy.matrix)
        scratchColor.copy(bl.color).multiplyScalar(dry)
        splat.setColorAt(si, scratchColor)
        si++
      }
    }
    splat.instanceMatrix.needsUpdate = true
    if (splat.instanceColor) splat.instanceColor.needsUpdate = true

    // ---- small remains -------------------------------------------------
    let li = 0
    for (let e = 0; e < KILLS.length; e++) {
      const kill = KILLS[e]
      const age = t - kill.t
      const shown = active && age >= REMAINS_DELAY
      const pop = shown ? Math.min(1, (age - REMAINS_DELAY) / 0.4) : 0
      for (let l = 0; l < kill.lumps.length; l++) {
        const lp = kill.lumps[l]
        if (!shown) {
          dummy.position.set(0, -1000, 0)
          dummy.scale.setScalar(0)
          dummy.rotation.set(0, 0, 0)
          dummy.updateMatrix()
          lump.setMatrixAt(li, dummy.matrix)
          li++
          continue
        }
        dummy.position.set(kill.x + lp.dx, lp.r * 0.5, kill.z + lp.dz)
        dummy.rotation.set(lp.dx, lp.dz, 0)
        dummy.scale.set(lp.r * pop, lp.r * 0.7 * pop, lp.r * pop)
        dummy.updateMatrix()
        lump.setMatrixAt(li, dummy.matrix)
        lump.setColorAt(li, lp.color)
        li++
      }
    }
    lump.instanceMatrix.needsUpdate = true
    if (lump.instanceColor) lump.instanceColor.needsUpdate = true
  })

  return (
    <group>
      <instancedMesh
        ref={mistRef}
        args={[TETRA, mistMat, MIST_COUNT]}
        frustumCulled={false}
      />
      <instancedMesh
        ref={splatRef}
        args={[DISC, splatMat, SPLAT_COUNT]}
        frustumCulled={false}
        receiveShadow
      />
      <instancedMesh
        ref={lumpRef}
        args={[LUMP, lumpMat, LUMP_COUNT]}
        frustumCulled={false}
      />
    </group>
  )
}
