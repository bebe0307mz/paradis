import { useMemo } from 'react'
import * as THREE from 'three'
import {
  DISTRICTS,
  DISTRICT_R,
  MARIA_R,
  ROSE_R,
  SINA_R,
  districtGateCenter,
} from '../world/constants'
import { mulberry32, range } from '../world/rng'

const RINGS = [SINA_R, ROSE_R, MARIA_R]
const DISTRICT_CENTERS = DISTRICTS.map((dd) => {
  const c = districtGateCenter(dd)
  const o = [Math.sin(dd.angle), Math.cos(dd.angle)]
  // center of the town half-disc, pushed slightly outward
  return [c[0] + o[0] * DISTRICT_R * 0.4, c[2] + o[1] * DISTRICT_R * 0.4]
})

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/** 1 = full terrain relief, 0 = flattened (walls, districts, capital) */
function flattenFactor(x: number, z: number): number {
  const r = Math.hypot(x, z)
  let f = 1
  for (const R of RINGS) f = Math.min(f, smoothstep(180, 520, Math.abs(r - R)))
  for (const [cx, cz] of DISTRICT_CENTERS) {
    f = Math.min(f, smoothstep(DISTRICT_R + 120, DISTRICT_R + 550, Math.hypot(x - cx, z - cz)))
  }
  f = Math.min(f, smoothstep(700, 1400, r)) // Mitras plateau
  return f
}

function relief(x: number, z: number): number {
  return (
    14 * Math.sin(x * 0.00021 + 1.7) * Math.sin(z * 0.00019 + 0.4) +
    7 * Math.sin(x * 0.0006 + 3.1) * Math.sin(z * 0.00072 + 1.2) +
    3 * Math.sin(x * 0.0019 + 0.6) * Math.sin(z * 0.0023 + 2.8)
  )
}

export function terrainHeight(x: number, z: number): number {
  return relief(x, z) * flattenFactor(x, z)
}

export function Island() {
  const terrain = useMemo(() => {
    const size = 46000
    const segs = 220
    const geo = new THREE.PlaneGeometry(size, size, segs, segs)
    geo.rotateX(-Math.PI / 2)
    const pos = geo.attributes.position
    const colors = new Float32Array(pos.count * 3)
    const cA = new THREE.Color('#66794a')
    const cB = new THREE.Color('#87975f')
    const cC = new THREE.Color('#75855a')
    const tmp = new THREE.Color()
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const z = pos.getZ(i)
      const h = terrainHeight(x, z)
      pos.setY(i, h - 0.4)
      const n = 0.5 + 0.5 * Math.sin(x * 0.00093 + 2.2) * Math.sin(z * 0.00081 + 0.9)
      tmp.copy(cA).lerp(cB, n)
      // faded farmland patches
      const patch = Math.sin(x * 0.0031) * Math.sin(z * 0.0028)
      if (patch > 0.55) tmp.lerp(cC, 0.6)
      colors[i * 3] = tmp.r
      colors[i * 3 + 1] = tmp.g
      colors[i * 3 + 2] = tmp.b
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geo.computeVertexNormals()
    return geo
  }, [])

  const { trunks, canopies } = useMemo(() => {
    const rand = mulberry32(133707)
    const mats: THREE.Matrix4[] = []
    const tmpObj = new THREE.Object3D()
    const heights: number[] = []
    const target = 8500
    let guard = 0
    while (mats.length < target && guard++ < target * 6) {
      const a = rand() * Math.PI * 2
      const r = Math.sqrt(rand()) * 15200
      const x = Math.sin(a) * r
      const z = Math.cos(a) * r
      if (r < 900) continue
      let bad = false
      for (const R of RINGS) if (Math.abs(r - R) < 260) bad = true
      for (const [cx, cz] of DISTRICT_CENTERS) {
        if (Math.hypot(x - cx, z - cz) < DISTRICT_R + 260) bad = true
      }
      if (bad) continue
      if (r < SINA_R - 300 && rand() > 0.3) continue // interior kept mostly open farmland
      // giant-tree forest cluster between Rose and Maria (the titan forest)
      const inForest = Math.hypot(x - 3600, z - 10050) < 900
      const h = inForest ? range(rand, 50, 76) : range(rand, 9, 22)
      tmpObj.position.set(x, terrainHeight(x, z), z)
      tmpObj.scale.set(h * 0.42, h, h * 0.42)
      tmpObj.rotation.y = rand() * Math.PI
      tmpObj.updateMatrix()
      mats.push(tmpObj.matrix.clone())
      heights.push(h)
    }
    const trunks = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.06, 0.09, 0.45, 5).translate(0, 0.22, 0),
      new THREE.MeshStandardMaterial({ color: '#6b5138', roughness: 1 }),
      mats.length,
    )
    const canopies = new THREE.InstancedMesh(
      new THREE.ConeGeometry(0.5, 0.75, 7).translate(0, 0.75, 0),
      new THREE.MeshStandardMaterial({ color: '#4c5f38', roughness: 1 }),
      mats.length,
    )
    const green = new THREE.Color()
    for (let i = 0; i < mats.length; i++) {
      trunks.setMatrixAt(i, mats[i])
      canopies.setMatrixAt(i, mats[i])
      green.setHSL(0.26 + (heights[i] % 1) * 0.05, 0.32, 0.26 + (heights[i] % 0.13))
      canopies.setColorAt(i, green)
    }
    trunks.instanceMatrix.needsUpdate = true
    canopies.instanceMatrix.needsUpdate = true
    if (canopies.instanceColor) canopies.instanceColor.needsUpdate = true
    return { trunks, canopies }
  }, [])

  const mountains = useMemo(() => {
    const rand = mulberry32(99)
    const items: { pos: [number, number, number]; r: number; h: number }[] = []
    for (let i = 0; i < 34; i++) {
      const a = rand() * Math.PI * 2
      const r = range(rand, 19500, 23500)
      items.push({
        pos: [Math.sin(a) * r, 0, Math.cos(a) * r],
        r: range(rand, 2200, 4200),
        h: range(rand, 800, 1900),
      })
    }
    return items
  }, [])

  return (
    <group>
      <mesh geometry={terrain}>
        <meshStandardMaterial vertexColors roughness={1} />
      </mesh>
      <primitive object={trunks} />
      <primitive object={canopies} />
      {mountains.map((m, i) => (
        <mesh key={i} position={[m.pos[0], m.h / 2 - 60, m.pos[2]]}>
          <coneGeometry args={[m.r, m.h, 7]} />
          <meshStandardMaterial color="#89907f" roughness={1} />
        </mesh>
      ))}
    </group>
  )
}
