// Procedural medieval towns inside every district + the royal capital Mitras.
// Everything is STATIC: built once in useMemo, matrices + instanceColor baked,
// zero per-frame work. All placement is deterministic (seeded per district).

import { useMemo, useRef, useLayoutEffect } from 'react'
import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Color,
  InstancedMesh,
  Object3D,
} from 'three'
import {
  DISTRICTS,
  DISTRICT_R,
  districtGateCenter,
  districtOutward,
  type DistrictDef,
} from '../world/constants'
import { mulberry32, range } from '../world/rng'

// ---------------------------------------------------------------------------
// palettes
// ---------------------------------------------------------------------------
const PLASTER = ['#d8cfbc', '#c2b49a', '#cfbfa5']
const TERRACOTTA = ['#9a5b43', '#8a4f3a', '#a86a4e']
const CIVIC = ['#b8ad93', '#a89877'] // church / warehouse walls
const MITRAS_WALL = ['#e8e3d6', '#dcd6c6', '#efece1'] // whiter, grander
const MITRAS_ROOF = ['#6f7d86', '#5c6a74', '#7d8b93'] // slate / lead roofs
const KEEP_COLOR = '#efeadd'

// deterministic seed from a district id string
function hashId(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

interface Body {
  x: number
  y: number
  z: number
  w: number
  d: number
  h: number
  yaw: number
  color: string
  roofColor: string
  // roofs are their own instance; civic buildings skip the roof cone
  roof: boolean
}

// ---------------------------------------------------------------------------
// one district's worth of buildings, laid out on the semicircular half-disc
// ---------------------------------------------------------------------------
function layoutDistrict(dd: DistrictDef, houseTarget: number): Body[] {
  const rand = mulberry32(hashId(dd.id))
  const C = districtGateCenter(dd)
  const o = districtOutward(dd) // outward, along the street (u axis)
  const l: [number, number, number] = [Math.cos(dd.angle), 0, -Math.sin(dd.angle)] // lateral (v axis)
  const baseYaw = Math.atan2(o[0], o[2]) // grid aligned to face down the street

  const bodies: Body[] = []

  // jittered grid over u (outward) x v (lateral)
  const CELL_U = 22
  const CELL_V = 18
  const U_MIN = 35
  const U_MAX = 520
  let placed = 0

  // walk grid cells; skip full rows/cols periodically to carve cross/side streets
  let ui = 0
  for (let u = U_MIN; u < U_MAX && placed < houseTarget; u += CELL_U, ui++) {
    // periodic cross street (a cleared ring of cells running lateral)
    const crossStreet = ui > 0 && ui % 5 === 0
    if (crossStreet) continue

    const halfV = Math.sqrt(Math.max(0, DISTRICT_R * DISTRICT_R - u * u)) - 25
    if (halfV <= 20) continue

    let vi = 0
    for (let v = -halfV; v <= halfV; v += CELL_V, vi++) {
      if (placed >= houseTarget) break
      // periodic side street (cleared column of cells running outward)
      if (vi > 0 && vi % 7 === 0) continue

      // KEEP CLEAR: main street down the middle
      if (Math.abs(v) < 16) continue
      // KEEP CLEAR: plaza near the inner gate
      if (u < 60 && Math.abs(v) < 60) continue

      // occasional gap for irregularity
      if (rand() < 0.12) continue

      const ju = u + range(rand, -5, 5)
      const jv = v + range(rand, -4, 4)
      // re-check bounds after jitter so no house pokes through the wall
      const hv = Math.sqrt(Math.max(0, DISTRICT_R * DISTRICT_R - ju * ju)) - 25
      if (ju < U_MIN || ju > U_MAX || Math.abs(jv) > hv) continue

      const wx = C[0] + o[0] * ju + l[0] * jv
      const wz = C[2] + o[2] * ju + l[2] * jv

      const w = range(rand, 8, 14)
      const d = range(rand, 8, 14)
      const h = range(rand, 5, 9)
      const ci = Math.floor(rand() * PLASTER.length)
      const ri = Math.floor(rand() * TERRACOTTA.length)
      bodies.push({
        x: wx,
        y: h / 2,
        z: wz,
        w,
        d,
        h,
        yaw: baseYaw + range(rand, -0.09, 0.09),
        color: PLASTER[ci],
        roofColor: TERRACOTTA[ri],
        roof: true,
      })
      placed++
    }
  }

  // one or two larger civic buildings near the plaza (church / warehouse)
  const civicCount = dd.id === 'shiganshina' ? 2 : dd.named ? 1 : 0
  for (let c = 0; c < civicCount; c++) {
    const cu = range(rand, 70, 130)
    const cv = (c === 0 ? -1 : 1) * range(rand, 70, 120)
    const wx = C[0] + o[0] * cu + l[0] * cv
    const wz = C[2] + o[2] * cu + l[2] * cv
    const w = range(rand, 14, 20)
    const d = range(rand, 20, 30)
    const h = range(rand, 15, 17)
    bodies.push({
      x: wx,
      y: h / 2,
      z: wz,
      w,
      d,
      h,
      yaw: baseYaw + range(rand, -0.05, 0.05),
      color: CIVIC[c % CIVIC.length],
      roofColor: TERRACOTTA[0],
      roof: true,
    })
  }

  return bodies
}

// ---------------------------------------------------------------------------
// Mitras — the royal capital at world origin, inside Wall Sina.
// Compact circular cluster of whiter/grander buildings around a central keep.
// ---------------------------------------------------------------------------
function layoutMitras(): Body[] {
  const rand = mulberry32(hashId('mitras-capital'))
  const bodies: Body[] = []
  const CLUSTER_R = 400
  const KEEP_CLEAR = 90 // keep the plaza around the central keep open
  const n = 150
  let placed = 0
  let guard = 0
  while (placed < n && guard < n * 6) {
    guard++
    // uniform-ish disc sampling
    const rr = Math.sqrt(rand()) * CLUSTER_R
    if (rr < KEEP_CLEAR) continue
    const th = rand() * Math.PI * 2
    const wx = Math.cos(th) * rr
    const wz = Math.sin(th) * rr
    const w = range(rand, 9, 15)
    const d = range(rand, 9, 15)
    const h = range(rand, 8, 16) // grander than district houses
    bodies.push({
      x: wx,
      y: h / 2,
      z: wz,
      w,
      d,
      h,
      yaw: Math.atan2(wx, wz) + range(rand, -0.25, 0.25), // roughly radial
      color: MITRAS_WALL[Math.floor(rand() * MITRAS_WALL.length)],
      roofColor: MITRAS_ROOF[Math.floor(rand() * MITRAS_ROOF.length)],
      roof: true,
    })
    placed++
  }
  return bodies
}

export function Town() {
  const bodyRef = useRef<InstancedMesh>(null)
  const roofRef = useRef<InstancedMesh>(null)

  // build all bodies once
  const { bodies, roofCount } = useMemo(() => {
    const all: Body[] = []
    for (const dd of DISTRICTS) {
      const target =
        dd.id === 'shiganshina' ? 600 : dd.named ? 300 : 200
      all.push(...layoutDistrict(dd, target))
    }
    all.push(...layoutMitras())
    return { bodies: all, roofCount: all.filter((b) => b.roof).length }
  }, [])

  const bodyCount = bodies.length

  // Mitras central keep: a tall cylindrical tower + smaller flanking towers.
  const keep = useMemo(() => {
    const rand = mulberry32(hashId('mitras-keep'))
    const towers: { x: number; z: number; r: number; h: number }[] = []
    towers.push({ x: 0, z: 0, r: 18, h: 70 }) // central keep
    const ring = 5
    for (let i = 0; i < ring; i++) {
      const th = (i / ring) * Math.PI * 2
      const rr = 34
      towers.push({
        x: Math.cos(th) * rr,
        z: Math.sin(th) * rr,
        r: range(rand, 7, 10),
        h: range(rand, 34, 46),
      })
    }
    return towers
  }, [])

  useLayoutEffect(() => {
    const bm = bodyRef.current
    const rm = roofRef.current
    if (!bm || !rm) return

    const dummy = new Object3D()
    const col = new Color()
    let ri = 0

    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i]
      // body
      dummy.position.set(b.x, b.y, b.z)
      dummy.rotation.set(0, b.yaw, 0)
      dummy.scale.set(b.w, b.h, b.d)
      dummy.updateMatrix()
      bm.setMatrixAt(i, dummy.matrix)
      col.set(b.color)
      bm.setColorAt(i, col)

      if (b.roof) {
        // pitched roof sits on top with a slight overhang; the cone geometry is
        // 4-sided (radialSegments 4) with radius 0.5 & height 0.5 unit -> scaled.
        const overhang = 1.15
        const roofH = b.h * 0.5
        dummy.position.set(b.x, b.h + roofH / 2, b.z)
        dummy.rotation.set(0, b.yaw + Math.PI / 4, 0)
        // cone radius param is 0.5 -> width = scale; scale to cover footprint diagonal
        const span = Math.max(b.w, b.d) * overhang
        dummy.scale.set(span, roofH, span)
        dummy.updateMatrix()
        rm.setMatrixAt(ri, dummy.matrix)
        col.set(b.roofColor)
        rm.setColorAt(ri, col)
        ri++
      }
    }
    bm.instanceMatrix.needsUpdate = true
    rm.instanceMatrix.needsUpdate = true
    if (bm.instanceColor) bm.instanceColor.needsUpdate = true
    if (rm.instanceColor) rm.instanceColor.needsUpdate = true
  }, [bodies])

  // shared unit geometries (scaled per instance via matrix)
  const bodyGeo = useMemo(() => new BoxGeometry(1, 1, 1), [])
  const roofGeo = useMemo(() => {
    // 4-sided cone => pyramid; unit radius 0.5, unit height 1
    const g = new ConeGeometry(0.5, 1, 4)
    return g
  }, [])
  const keepGeo = useMemo(() => new CylinderGeometry(1, 1, 1, 12), [])

  return (
    <group>
      <instancedMesh
        ref={bodyRef}
        args={[bodyGeo, undefined, bodyCount]}
        castShadow
        receiveShadow
        frustumCulled={false}
      >
        <meshStandardMaterial roughness={0.9} metalness={0} />
      </instancedMesh>

      <instancedMesh
        ref={roofRef}
        args={[roofGeo, undefined, roofCount]}
        castShadow
        frustumCulled={false}
      >
        <meshStandardMaterial roughness={0.85} metalness={0} />
      </instancedMesh>

      {/* Mitras central keep + flanking towers (unique meshes) */}
      {keep.map((t, i) => (
        <mesh
          key={i}
          geometry={keepGeo}
          position={[t.x, t.h / 2, t.z]}
          scale={[t.r, t.h, t.r]}
          castShadow
          receiveShadow
        >
          <meshStandardMaterial color={KEEP_COLOR} roughness={0.8} metalness={0} />
        </mesh>
      ))}
      {/* conical caps on the keep towers */}
      {keep.map((t, i) => (
        <mesh
          key={`cap-${i}`}
          position={[t.x, t.h + t.r * 0.9, t.z]}
          castShadow
        >
          <coneGeometry args={[t.r * 1.1, t.r * 1.9, 8]} />
          <meshStandardMaterial color={MITRAS_ROOF[1]} roughness={0.7} metalness={0} />
        </mesh>
      ))}
    </group>
  )
}
