// The Shiganshina crowd: 320 instanced civilians driven by the incident frame.
// Position/yaw come from frame.people (a stable array mutated in place at 60fps).
// Read ONLY inside useFrame; never lift frame data into React state.
// Zero allocations per frame — temp Object3D + Color reused.

import { useMemo, useRef, useLayoutEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  CapsuleGeometry,
  Color,
  InstancedMesh,
  Object3D,
  SphereGeometry,
} from 'three'
import { getFrame } from '../incidents/driver'
import { mulberry32 } from '../world/rng'

const COUNT = 320

// muted period clothing: browns, faded blues, greys, occasional dark red
const CLOTHES = [
  '#6b5842',
  '#7a6a4f',
  '#574b3a',
  '#5c6670',
  '#6e7680',
  '#4f5a63',
  '#8a8378',
  '#9a5a4a', // occasional dark red
]
const SKIN = ['#c9a785', '#b98f6b', '#d8b48f', '#a97f5c']

const BODY_H = 1.15 // capsule body height (legs+torso), head added on top
const HEAD_R = 0.14

// deterministic per-index visual + phase data (built once)
interface Trait {
  color: string
  head: string
  phase: number // bob phase offset so the crowd doesn't sync
}

export function People() {
  const bodyRef = useRef<InstancedMesh>(null)
  const headRef = useRef<InstancedMesh>(null)

  const traits = useMemo<Trait[]>(() => {
    const rand = mulberry32(0x5eed)
    const out: Trait[] = []
    for (let i = 0; i < COUNT; i++) {
      out.push({
        color: CLOTHES[Math.floor(rand() * CLOTHES.length)],
        head: SKIN[Math.floor(rand() * SKIN.length)],
        phase: rand() * Math.PI * 2,
      })
    }
    return out
  }, [])

  // reusable geometries (unit-ish; matrix places/scales each instance)
  const bodyGeo = useMemo(
    () => new CapsuleGeometry(0.25, BODY_H - 0.5, 4, 8),
    [],
  )
  const headGeo = useMemo(() => new SphereGeometry(HEAD_R, 8, 6), [])

  // bake instance colors once
  useLayoutEffect(() => {
    const bm = bodyRef.current
    const hm = headRef.current
    if (!bm || !hm) return
    const col = new Color()
    for (let i = 0; i < COUNT; i++) {
      col.set(traits[i].color)
      bm.setColorAt(i, col)
      col.set(traits[i].head)
      hm.setColorAt(i, col)
    }
    if (bm.instanceColor) bm.instanceColor.needsUpdate = true
    if (hm.instanceColor) hm.instanceColor.needsUpdate = true
  }, [traits])

  // scratch objects reused every frame — zero per-frame allocation
  const dummy = useMemo(() => new Object3D(), [])

  useFrame((state) => {
    const bm = bodyRef.current
    const hm = headRef.current
    if (!bm || !hm) return
    const frame = getFrame()
    const people = frame.people
    const time = state.clock.elapsedTime

    for (let i = 0; i < COUNT; i++) {
      const p = people[i]
      const tr = traits[i]

      if (!p || p.mode === 'gone') {
        dummy.position.set(0, -1000, 0)
        dummy.scale.set(0, 0, 0)
        dummy.rotation.set(0, 0, 0)
        dummy.updateMatrix()
        bm.setMatrixAt(i, dummy.matrix)
        hm.setMatrixAt(i, dummy.matrix)
        continue
      }

      const x = p.pos[0]
      const y = p.pos[1] // nonzero while grabbed — render exactly as given
      const z = p.pos[2]

      // walk/run bob: frequency scales with speed, phase offset per index
      const freq = 2 + p.speed * 1.4
      const ph = time * freq + tr.phase
      let bob = 0
      let tilt = 0

      if (p.mode === 'grabbed') {
        // flailing: fast alternating tilt, no ground bob
        const ff = time * 16 + tr.phase
        tilt = Math.sin(ff) * 0.5
      } else if (p.speed > 0.01) {
        bob = Math.abs(Math.sin(ph)) * (0.02 + p.speed * 0.012)
        tilt = Math.sin(ph) * (0.015 + p.speed * 0.01)
      }

      // body — capsule center sits at half its height above the ground
      const bodyY = y + BODY_H / 2 + bob
      dummy.position.set(x, bodyY, z)
      dummy.rotation.set(tilt, p.yaw, tilt * 0.6)
      dummy.scale.set(1, 1, 1)
      dummy.updateMatrix()
      bm.setMatrixAt(i, dummy.matrix)

      // head — riding on top of the body, following the same tilt/bob
      const headY = y + BODY_H + HEAD_R + bob
      dummy.position.set(
        x - Math.sin(tilt) * (BODY_H * 0.5),
        headY,
        z,
      )
      dummy.rotation.set(tilt, p.yaw, tilt * 0.6)
      dummy.scale.set(1, 1, 1)
      dummy.updateMatrix()
      hm.setMatrixAt(i, dummy.matrix)
    }

    bm.instanceMatrix.needsUpdate = true
    hm.instanceMatrix.needsUpdate = true
  })

  return (
    <group>
      <instancedMesh
        ref={bodyRef}
        args={[bodyGeo, undefined, COUNT]}
        castShadow
        frustumCulled={false}
      >
        <meshStandardMaterial vertexColors roughness={0.95} metalness={0} />
      </instancedMesh>
      <instancedMesh
        ref={headRef}
        args={[headGeo, undefined, COUNT]}
        castShadow
        frustumCulled={false}
      >
        <meshStandardMaterial vertexColors roughness={0.9} metalness={0} />
      </instancedMesh>
    </group>
  )
}
