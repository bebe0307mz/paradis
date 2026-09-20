// Burning Shiganshina for Episode 1. Like everything in the incident, this is a
// PURE function of frame.t: flame flicker, smoke spawn cycles and light
// intensity are all driven by deterministic hashes of t (never wall-clock), so
// scrubbing the timeline forward and backward reproduces the exact same fire.
//
// Instancing:
//   - one InstancedMesh per flame layer (outer / mid / inner) across ALL fires
//   - one InstancedMesh for every smoke puff across all fires
//   - at most 5 real THREE.PointLights, on the 5 largest fires
//
// A fire's growth: grow = clamp((t - t0)/5, 0, 1) * scale. Nothing renders while
// grow <= 0 (instances collapse to scale 0).

import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { getFrame } from '../incidents/driver.ts'
import { mulberry32 } from '../world/rng.ts'
import { FIRE_SPOTS } from '../incidents/ep1.ts'

// ---------------------------------------------------------------------------
// tuning
// ---------------------------------------------------------------------------
const GROW_TIME = 5 // seconds from ignition to full size
const BASE_HEIGHT = 13 // metres at full grow (flame column, before scale mult)
const SMOKE_PER_FIRE = 6
const SMOKE_PERIOD = 3.4 // seconds for one puff to rise + fade
const SMOKE_RISE = 46 // metres a puff climbs over its life
const MAX_LIGHTS = 5

// ---------------------------------------------------------------------------
// shared geometry / scratch
// ---------------------------------------------------------------------------
const CONE = new THREE.ConeGeometry(1, 1, 8, 1, true)
const PLANE = new THREE.PlaneGeometry(1, 1)

const dummy = new THREE.Object3D()

// ---------------------------------------------------------------------------
// per-fire deterministic descriptors
// ---------------------------------------------------------------------------
interface FireDesc {
  x: number
  z: number
  t0: number
  scale: number
  seed: number // per-fire hash offset for flicker
  smokePhase: number[] // staggered start phase per puff
  smokeDrift: number[] // wind drift x per puff
  smokeDriftZ: number[]
  smokeSway: number[]
}

const FIRES: FireDesc[] = FIRE_SPOTS.map((f, i) => {
  const rand = mulberry32(2000 + i)
  const smokePhase: number[] = []
  const smokeDrift: number[] = []
  const smokeDriftZ: number[] = []
  const smokeSway: number[] = []
  for (let s = 0; s < SMOKE_PER_FIRE; s++) {
    smokePhase.push(s / SMOKE_PER_FIRE + rand() * 0.05)
    smokeDrift.push((rand() - 0.2) * 10) // biased wind
    smokeDriftZ.push((rand() - 0.5) * 6)
    smokeSway.push(rand() * Math.PI * 2)
  }
  return {
    x: f.x,
    z: f.z,
    t0: f.t0,
    scale: f.scale,
    seed: i * 7 + 3,
    smokePhase,
    smokeDrift,
    smokeDriftZ,
    smokeSway,
  }
})

// The 5 largest fires get a point light.
const LIT_INDICES = FIRES.map((f, i) => ({ i, scale: f.scale }))
  .sort((a, b) => b.scale - a.scale)
  .slice(0, MAX_LIGHTS)
  .map((o) => o.i)

const FLAME_COUNT = FIRES.length
const SMOKE_COUNT = FIRES.length * SMOKE_PER_FIRE

// deterministic flicker in [0,1]-ish from t (no wall clock)
function flicker(t: number, seed: number): number {
  return (
    0.5 +
    0.28 * Math.sin(t * 13 + seed * 7) +
    0.16 * Math.sin(t * 27.3 + seed * 3.1) +
    0.06 * Math.sin(t * 41.7 + seed)
  )
}

// ---------------------------------------------------------------------------
export function Fires() {
  const outerRef = useRef<THREE.InstancedMesh>(null)
  const midRef = useRef<THREE.InstancedMesh>(null)
  const innerRef = useRef<THREE.InstancedMesh>(null)
  const smokeRef = useRef<THREE.InstancedMesh>(null)
  const lightRefs = useRef<(THREE.PointLight | null)[]>([])

  const outerMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: 0xd12a10,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
      }),
    [],
  )
  const midMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: 0xff7a1e,
        transparent: true,
        opacity: 0.7,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
      }),
    [],
  )
  const innerMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: 0xffdc5a,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
      }),
    [],
  )
  const smokeMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: 0x2b2824,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    [],
  )

  useFrame(({ camera }) => {
    const frame = getFrame()
    const outer = outerRef.current
    const mid = midRef.current
    const inner = innerRef.current
    const smoke = smokeRef.current
    if (!outer || !mid || !inner || !smoke) return

    const active = frame.active
    const t = frame.t

    // ---- flames --------------------------------------------------------
    for (let f = 0; f < FIRES.length; f++) {
      const fire = FIRES[f]
      const grow = active
        ? Math.min(1, Math.max(0, (t - fire.t0) / GROW_TIME)) * fire.scale
        : 0
      if (grow <= 0) {
        dummy.position.set(0, -1000, 0)
        dummy.scale.setScalar(0)
        dummy.rotation.set(0, 0, 0)
        dummy.updateMatrix()
        outer.setMatrixAt(f, dummy.matrix)
        mid.setMatrixAt(f, dummy.matrix)
        inner.setMatrixAt(f, dummy.matrix)
        continue
      }
      const fl = flicker(t, fire.seed)
      const h = BASE_HEIGHT * grow
      const skew = 0.14 * (fl - 0.5)

      // outer red-orange — tallest, widest, most flicker on height
      const oh = h * (1.35 + fl * 0.5)
      dummy.position.set(fire.x, oh / 2, fire.z)
      dummy.rotation.set(0, fire.seed, skew)
      dummy.scale.set(grow * 3.4 * (0.9 + fl * 0.25), oh, grow * 3.4 * (0.9 + fl * 0.25))
      dummy.updateMatrix()
      outer.setMatrixAt(f, dummy.matrix)

      // mid orange
      const mh = h * (1.0 + fl * 0.35)
      dummy.position.set(fire.x + skew * 2, mh / 2, fire.z)
      dummy.rotation.set(0, fire.seed * 1.7, -skew * 0.8)
      dummy.scale.set(grow * 2.3 * (0.9 + fl * 0.2), mh, grow * 2.3 * (0.9 + fl * 0.2))
      dummy.updateMatrix()
      mid.setMatrixAt(f, dummy.matrix)

      // inner yellow — short, bright, tight core
      const ih = h * (0.6 + fl * 0.28)
      dummy.position.set(fire.x + skew, ih / 2, fire.z)
      dummy.rotation.set(0, fire.seed * 2.3, skew * 0.6)
      dummy.scale.set(grow * 1.3 * (0.85 + fl * 0.2), ih, grow * 1.3 * (0.85 + fl * 0.2))
      dummy.updateMatrix()
      inner.setMatrixAt(f, dummy.matrix)
    }
    outer.instanceMatrix.needsUpdate = true
    mid.instanceMatrix.needsUpdate = true
    inner.instanceMatrix.needsUpdate = true

    // ---- smoke (billboarded planes, cyclic spawn) ----------------------
    let si = 0
    for (let f = 0; f < FIRES.length; f++) {
      const fire = FIRES[f]
      const grow = active
        ? Math.min(1, Math.max(0, (t - fire.t0) / GROW_TIME)) * fire.scale
        : 0
      for (let s = 0; s < SMOKE_PER_FIRE; s++) {
        // life phase 0..1, looping — deterministic in t
        const raw = (t - fire.t0) / SMOKE_PERIOD + fire.smokePhase[s]
        const life = raw > 0 ? raw - Math.floor(raw) : -1
        const born = active && grow > 0.02 && raw > 0
        if (!born) {
          dummy.position.set(0, -1000, 0)
          dummy.scale.setScalar(0)
          dummy.quaternion.identity()
          dummy.updateMatrix()
          smoke.setMatrixAt(si, dummy.matrix)
          si++
          continue
        }
        const rise = life * SMOKE_RISE * (0.7 + grow * 0.3)
        const sway = Math.sin(life * 3 + fire.smokeSway[s]) * 3
        const y = BASE_HEIGHT * grow * 0.8 + rise
        const px = fire.x + fire.smokeDrift[s] * life + sway
        const pz = fire.z + fire.smokeDriftZ[s] * life
        // grow the puff as it climbs, fade in then out
        const sizeUp = (2.5 + life * 10) * grow
        // fade: ramp in over first 15%, out over the top 45%
        const fadeIn = Math.min(1, life / 0.15)
        const fadeOut = life > 0.55 ? Math.max(0, 1 - (life - 0.55) / 0.45) : 1
        const alpha = fadeIn * fadeOut

        dummy.position.set(px, y, pz)
        dummy.quaternion.copy(camera.quaternion) // billboard toward camera
        dummy.scale.set(sizeUp * (0.9 + alpha * 0.2), sizeUp, 1)
        dummy.updateMatrix()
        smoke.setMatrixAt(si, dummy.matrix)
        si++
      }
    }
    smoke.instanceMatrix.needsUpdate = true

    // ---- lights (max 5, on the largest fires) --------------------------
    for (let k = 0; k < LIT_INDICES.length; k++) {
      const light = lightRefs.current[k]
      if (!light) continue
      const fire = FIRES[LIT_INDICES[k]]
      const grow = active
        ? Math.min(1, Math.max(0, (t - fire.t0) / GROW_TIME)) * fire.scale
        : 0
      if (grow <= 0) {
        light.intensity = 0
        light.visible = false
        continue
      }
      const fl = flicker(t, fire.seed)
      light.visible = true
      light.position.set(fire.x, BASE_HEIGHT * grow * 0.5 + 2, fire.z)
      light.intensity = grow * (2.5 + fl * 2)
    }
  })

  return (
    <group>
      <instancedMesh ref={outerRef} args={[CONE, outerMat, FLAME_COUNT]} frustumCulled={false} />
      <instancedMesh ref={midRef} args={[CONE, midMat, FLAME_COUNT]} frustumCulled={false} />
      <instancedMesh ref={innerRef} args={[CONE, innerMat, FLAME_COUNT]} frustumCulled={false} />
      <instancedMesh ref={smokeRef} args={[PLANE, smokeMat, SMOKE_COUNT]} frustumCulled={false} />
      {LIT_INDICES.map((_, k) => (
        <pointLight
          key={`fire-light-${k}`}
          ref={(el) => {
            lightRefs.current[k] = el
          }}
          color={0xff7733}
          distance={140}
          decay={2}
          intensity={0}
        />
      ))}
    </group>
  )
}
