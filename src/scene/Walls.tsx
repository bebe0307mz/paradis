import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import {
  DISTRICTS,
  DISTRICT_R,
  GATE_H,
  GATE_W,
  WALL_H,
  WALL_T,
  districtGateCenter,
  type DistrictDef,
} from '../world/constants'
import { mulberry32, range } from '../world/rng'
import { getFrame } from '../incidents/driver'

const TAU = Math.PI * 2

// world angle convention: 0 = south (+Z), pos = [sin(a)*r, y, cos(a)*r].
// THREE.Shape lives in XY and extrudes to (x, height, -y), so shape angle = a - PI/2.
function annularSector(rIn: number, rOut: number, a0: number, a1: number): THREE.ExtrudeGeometry {
  const p0 = a0 - Math.PI / 2
  const p1 = a1 - Math.PI / 2
  const span = Math.abs(p1 - p0)
  const segs = Math.max(8, Math.ceil((span / TAU) * 340))
  const shape = new THREE.Shape()
  shape.moveTo(Math.cos(p0) * rOut, Math.sin(p0) * rOut)
  shape.absarc(0, 0, rOut, p0, p1, false)
  shape.lineTo(Math.cos(p1) * rIn, Math.sin(p1) * rIn)
  shape.absarc(0, 0, rIn, p1, p0, true)
  shape.closePath()
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: WALL_H,
    bevelEnabled: false,
    curveSegments: segs,
  })
  geo.rotateX(-Math.PI / 2)
  return geo
}

const wallMat = new THREE.MeshStandardMaterial({ color: '#cbc3ae', roughness: 0.92 })
const wallDarkMat = new THREE.MeshStandardMaterial({ color: '#b4ab94', roughness: 0.95 })

function GateArch({
  center,
  yaw,
  broken,
}: {
  center: [number, number, number]
  yaw: number
  broken?: boolean
}) {
  if (broken) return null
  const pillarW = 8
  const lintelH = WALL_H - GATE_H
  return (
    <group position={center} rotation={[0, yaw, 0]}>
      <mesh material={wallDarkMat} position={[-(GATE_W / 2 + pillarW / 2), WALL_H / 2, 0]}>
        <boxGeometry args={[pillarW, WALL_H, WALL_T + 2]} />
      </mesh>
      <mesh material={wallDarkMat} position={[GATE_W / 2 + pillarW / 2, WALL_H / 2, 0]}>
        <boxGeometry args={[pillarW, WALL_H, WALL_T + 2]} />
      </mesh>
      <mesh material={wallDarkMat} position={[0, GATE_H + lintelH / 2, 0]}>
        <boxGeometry args={[GATE_W + pillarW * 2, lintelH, WALL_T + 2]} />
      </mesh>
    </group>
  )
}

// ---------------------------------------------------------------------------
// debris for the two breakable Shiganshina gates
// ---------------------------------------------------------------------------
interface Chunk {
  p0: THREE.Vector3
  v: THREE.Vector3
  size: number
  tLand: number
  land: THREE.Vector3
  axis: THREE.Vector3
  spin: number
}

function buildChunks(seed: number): Chunk[] {
  const rand = mulberry32(seed)
  const chunks: Chunk[] = []
  for (let i = 0; i < 44; i++) {
    const size = range(rand, 1.6, 5.2)
    const p0 = new THREE.Vector3(
      range(rand, -(GATE_W / 2 + 10), GATE_W / 2 + 10),
      range(rand, 1, WALL_H - 2),
      range(rand, -WALL_T / 2, WALL_T / 2),
    )
    // kicked/smashed from outside — debris flies inward (-z local) and up
    const v = new THREE.Vector3(
      range(rand, -9, 9),
      range(rand, 3, 15),
      -range(rand, 7, 34),
    )
    const rest = size / 2
    const tLand = (v.y + Math.sqrt(v.y * v.y + 50 * Math.max(0.1, p0.y - rest))) / 25
    const land = new THREE.Vector3(
      p0.x + v.x * tLand,
      rest,
      p0.z + v.z * tLand,
    )
    const axis = new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize()
    chunks.push({ p0, v, size, tLand, land, axis, spin: range(rand, 1, 6) })
  }
  return chunks
}

const tmpObj = new THREE.Object3D()
const tmpQuat = new THREE.Quaternion()

function GateDebris({
  center,
  yaw,
  gate,
  seed,
}: {
  center: [number, number, number]
  yaw: number
  gate: 'outer' | 'inner'
  seed: number
}) {
  const chunks = useMemo(() => buildChunks(seed), [seed])
  const ref = useRef<THREE.InstancedMesh>(null)
  useFrame(() => {
    const mesh = ref.current
    if (!mesh) return
    const frame = getFrame()
    const age = gate === 'outer' ? frame.outerGateAge : frame.innerGateAge
    if (age < 0) {
      mesh.visible = false
      return
    }
    mesh.visible = true
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i]
      const t = Math.min(age, c.tLand)
      if (age >= c.tLand) {
        tmpObj.position.copy(c.land)
      } else {
        tmpObj.position.set(
          c.p0.x + c.v.x * t,
          c.p0.y + c.v.y * t - 12.5 * t * t,
          c.p0.z + c.v.z * t,
        )
      }
      tmpQuat.setFromAxisAngle(c.axis, c.spin * t)
      tmpObj.quaternion.copy(tmpQuat)
      tmpObj.scale.setScalar(c.size)
      tmpObj.updateMatrix()
      mesh.setMatrixAt(i, tmpObj.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
  })
  return (
    <group position={center} rotation={[0, yaw, 0]}>
      <instancedMesh ref={ref} args={[undefined, undefined, chunks.length]} material={wallDarkMat}>
        <boxGeometry args={[1, 1, 1]} />
      </instancedMesh>
    </group>
  )
}

function BreakableGate({
  center,
  yaw,
  gate,
  seed,
}: {
  center: [number, number, number]
  yaw: number
  gate: 'outer' | 'inner'
  seed: number
}) {
  const ref = useRef<THREE.Group>(null)
  useFrame(() => {
    const frame = getFrame()
    const broken = gate === 'outer' ? frame.outerGateBroken : frame.innerGateBroken
    if (ref.current) ref.current.visible = !broken
  })
  return (
    <>
      <group ref={ref}>
        <GateArch center={center} yaw={yaw} />
      </group>
      <GateDebris center={center} yaw={yaw} gate={gate} seed={seed} />
    </>
  )
}

// ---------------------------------------------------------------------------
export function Walls() {
  const { ringGeos, bulgeGeos } = useMemo(() => {
    const ringGeos: THREE.ExtrudeGeometry[] = []
    const bulgeGeos: { geo: THREE.ExtrudeGeometry; center: [number, number, number] }[] = []
    const walls: ('maria' | 'rose' | 'sina')[] = ['maria', 'rose', 'sina']
    for (const wall of walls) {
      const dds = DISTRICTS.filter((d) => d.wall === wall).sort((a, b) => a.angle - b.angle)
      const r = dds[0].wallR
      const ghw = (GATE_W / 2 + 8) / r
      for (let i = 0; i < dds.length; i++) {
        const a0 = dds[i].angle + ghw
        const a1 = (i + 1 < dds.length ? dds[i + 1].angle : dds[0].angle + TAU) - ghw
        ringGeos.push(annularSector(r - WALL_T / 2, r + WALL_T / 2, a0, a1))
      }
      // district bulge walls (semicircle outward, with outer-gate gap)
      for (const dd of dds) {
        const ghd = (GATE_W / 2 + 8) / DISTRICT_R
        const c = districtGateCenter(dd)
        const segs: [number, number][] = [
          [dd.angle - Math.PI / 2 + 0.05, dd.angle - ghd],
          [dd.angle + ghd, dd.angle + Math.PI / 2 - 0.05],
        ]
        for (const [a0, a1] of segs) {
          bulgeGeos.push({
            geo: annularSector(DISTRICT_R - WALL_T / 2, DISTRICT_R + WALL_T / 2, a0, a1),
            center: c,
          })
        }
      }
    }
    return { ringGeos, bulgeGeos }
  }, [])

  const gates = useMemo(() => {
    const out: { dd: DistrictDef; inner: [number, number, number]; outer: [number, number, number] }[] = []
    for (const dd of DISTRICTS) {
      const c = districtGateCenter(dd)
      const o = [Math.sin(dd.angle), 0, Math.cos(dd.angle)]
      out.push({
        dd,
        inner: c,
        outer: [c[0] + o[0] * DISTRICT_R, 0, c[2] + o[2] * DISTRICT_R],
      })
    }
    return out
  }, [])

  return (
    <group>
      {ringGeos.map((g, i) => (
        <mesh key={`ring-${i}`} geometry={g} material={wallMat} />
      ))}
      {bulgeGeos.map(({ geo, center }, i) => (
        <mesh key={`bulge-${i}`} geometry={geo} material={wallMat} position={center} />
      ))}
      {gates.map(({ dd, inner, outer }) =>
        dd.id === 'shiganshina' ? (
          <group key={dd.id}>
            <BreakableGate center={inner} yaw={dd.angle} gate="inner" seed={4451} />
            <BreakableGate center={outer} yaw={dd.angle} gate="outer" seed={8817} />
          </group>
        ) : (
          <group key={dd.id}>
            <GateArch center={inner} yaw={dd.angle} />
            <GateArch center={outer} yaw={dd.angle} />
          </group>
        ),
      )}
    </group>
  )
}
