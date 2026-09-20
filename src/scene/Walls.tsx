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

// ---------------------------------------------------------------------------
// shared materials
// ---------------------------------------------------------------------------
const wallMat = new THREE.MeshStandardMaterial({ color: '#cbc3ae', roughness: 0.92 })
const wallDarkMat = new THREE.MeshStandardMaterial({ color: '#b4ab94', roughness: 0.95 })
const stoneMat = new THREE.MeshStandardMaterial({ color: '#a49a82', roughness: 0.96 })
const stoneShadeMat = new THREE.MeshStandardMaterial({ color: '#8d846f', roughness: 0.97 })
const merlonMat = new THREE.MeshStandardMaterial({ color: '#9c937d', roughness: 0.95 })
const oakMat = new THREE.MeshStandardMaterial({ color: '#6e5232', roughness: 0.85 })
const oakDarkMat = new THREE.MeshStandardMaterial({ color: '#5a4126', roughness: 0.88 })
const ironMat = new THREE.MeshStandardMaterial({ color: '#2b2a28', roughness: 0.55, metalness: 0.6 })
// debris (all opaque)
const woodChunkMat = new THREE.MeshStandardMaterial({ color: '#3d2b18', roughness: 0.9 })
const stoneChunkMat = new THREE.MeshStandardMaterial({ color: '#9a917b', roughness: 0.97 })

const unitBox = new THREE.BoxGeometry(1, 1, 1)

// ---------------------------------------------------------------------------
// Closed double doors that fully fill the GATE_W x GATE_H opening.
// Recessed ~3m into the wall thickness. Dark aged oak + iron bands + arch cap.
// Local frame: opening centered at (0, 0..GATE_H, 0); +z faces outward.
// ---------------------------------------------------------------------------
const DOOR_RECESS = 3
const DOOR_Z = WALL_T / 2 - DOOR_RECESS // door face plane inside the wall
const LEAF_W = GATE_W / 2 - 0.3 // small center seam gap
const PLANK_COUNT = 7

function GateDoors() {
  // vertical plank slats, alternating depth so grooves read at a glance
  const plankW = LEAF_W / PLANK_COUNT
  const planks: { x: number; mat: THREE.Material; z: number }[] = []
  for (const side of [-1, 1]) {
    for (let i = 0; i < PLANK_COUNT; i++) {
      const cx = side * (0.3 + plankW * (i + 0.5))
      planks.push({
        x: cx,
        mat: i % 2 === 0 ? oakMat : oakDarkMat,
        z: i % 2 === 0 ? DOOR_Z : DOOR_Z - 0.35,
      })
    }
  }
  // horizontal iron bands
  const bandYs = [GATE_H * 0.12, GATE_H * 0.4, GATE_H * 0.68, GATE_H * 0.9]
  // arch cap: progressively narrower slabs stacked at the top
  const capSteps = 4
  return (
    <group>
      {/* recessed backing so nothing shows through */}
      <mesh material={oakDarkMat} position={[0, GATE_H / 2, DOOR_Z - 0.8]}>
        <boxGeometry args={[GATE_W - 0.4, GATE_H, 1.2]} />
      </mesh>
      {planks.map((p, i) => (
        <mesh key={`plank-${i}`} material={p.mat} position={[p.x, GATE_H / 2, p.z]}>
          <boxGeometry args={[plankW - 0.18, GATE_H - 1, 1.4]} />
        </mesh>
      ))}
      {/* center seam batten */}
      <mesh material={ironMat} position={[0, GATE_H / 2, DOOR_Z + 0.15]}>
        <boxGeometry args={[0.9, GATE_H - 2, 0.7]} />
      </mesh>
      {/* iron bands */}
      {bandYs.map((y, i) => (
        <mesh key={`band-${i}`} material={ironMat} position={[0, y, DOOR_Z + 0.25]}>
          <boxGeometry args={[GATE_W - 1.2, 1.4, 0.6]} />
        </mesh>
      ))}
      {/* iron bolt studs along the bands */}
      {bandYs.map((y) =>
        [-11, -6, 6, 11].map((x, j) => (
          <mesh key={`bolt-${y}-${j}`} material={ironMat} position={[x, y, DOOR_Z + 0.55]}>
            <boxGeometry args={[0.8, 0.8, 0.4]} />
          </mesh>
        )),
      )}
      {/* two large ring hinges near the seam */}
      {[GATE_H * 0.3, GATE_H * 0.7].map((y, i) => (
        <mesh key={`ring-${i}`} material={ironMat} position={[-2.2, y, DOOR_Z + 0.4]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[1.1, 0.22, 6, 12]} />
        </mesh>
      ))}
      {/* arch cap — narrowing slabs so the top is rounded, not a flat lintel */}
      {Array.from({ length: capSteps }).map((_, i) => {
        const t = i / capSteps
        const w = (GATE_W - 0.4) * (1 - t * 0.55)
        const y = GATE_H - 1.2 + i * 1.3
        return (
          <mesh key={`cap-${i}`} material={i % 2 === 0 ? oakMat : oakDarkMat} position={[0, y, DOOR_Z - 0.1]}>
            <boxGeometry args={[w, 1.6, 1.3]} />
          </mesh>
        )
      })}
    </group>
  )
}

// ---------------------------------------------------------------------------
// A crenellated flanking tower. ~14m square, ~58m tall, slight taper.
// Merlons rendered with one InstancedMesh.
// ---------------------------------------------------------------------------
const TOWER_W = 14
const TOWER_H = 58
const MERLON = 2.2

function Tower({ x }: { x: number }) {
  const merlons = useMemo(() => {
    const out: [number, number][] = [] // (mx, mz) on the rim
    const top = TOWER_W * 0.86 // tapered top footprint
    const half = top / 2
    const step = MERLON * 2
    const n = Math.floor(top / step)
    const start = -half + (top - n * step) / 2 + MERLON
    for (let i = 0; i <= n; i++) {
      const c = start + i * step
      out.push([c, half]) // front edge
      out.push([c, -half]) // back edge
      out.push([half, c]) // right edge
      out.push([-half, c]) // left edge
    }
    return out
  }, [])
  return (
    <group position={[x, 0, 0]}>
      {/* tapered shaft: two stacked boxes for a subtle batter */}
      <mesh material={stoneMat} position={[0, TOWER_H * 0.3, 0]}>
        <boxGeometry args={[TOWER_W, TOWER_H * 0.6, TOWER_W]} />
      </mesh>
      <mesh material={stoneMat} position={[0, TOWER_H * 0.8, 0]}>
        <boxGeometry args={[TOWER_W * 0.88, TOWER_H * 0.4, TOWER_W * 0.88]} />
      </mesh>
      {/* battlement ring (parapet) */}
      <mesh material={stoneShadeMat} position={[0, TOWER_H + 0.9, 0]}>
        <boxGeometry args={[TOWER_W * 0.92, 1.8, TOWER_W * 0.92]} />
      </mesh>
      {/* crenellations */}
      <instancedMesh
        ref={(m) => {
          if (!m) return
          const obj = new THREE.Object3D()
          for (let i = 0; i < merlons.length; i++) {
            const [mx, mz] = merlons[i]
            obj.position.set(mx, TOWER_H + 3, mz)
            obj.scale.set(MERLON, 3, MERLON)
            obj.updateMatrix()
            m.setMatrixAt(i, obj.matrix)
          }
          m.instanceMatrix.needsUpdate = true
        }}
        args={[unitBox, merlonMat, merlons.length]}
      />
      {/* narrow arrow-slit windows */}
      {[TOWER_H * 0.45, TOWER_H * 0.65].map((y, i) => (
        <mesh key={`slit-${i}`} material={oakDarkMat} position={[0, y, TOWER_W / 2 + 0.1]}>
          <boxGeometry args={[1.2, 4, 0.4]} />
        </mesh>
      ))}
    </group>
  )
}

// ---------------------------------------------------------------------------
// Full closed gatehouse: two towers + arched stone surround + closed doors.
// `showDoors` lets the breakable gate hide only the doors on breach while
// keeping the masonry standing.
// ---------------------------------------------------------------------------
function Gatehouse({
  center,
  yaw,
  showDoors = true,
}: {
  center: [number, number, number]
  yaw: number
  showDoors?: boolean
}) {
  const gap = GATE_W / 2 + 6 // tower inner face offset from opening center
  const lintelH = WALL_H - GATE_H
  const surroundT = WALL_T + 2.5
  // arched stone surround: stack of narrowing voussoir slabs over the opening
  const archSteps = 6
  return (
    <group position={center} rotation={[0, yaw, 0]}>
      <Tower x={-(gap + TOWER_W / 2)} />
      <Tower x={gap + TOWER_W / 2} />
      {/* solid masonry spanning tower-to-tower above the arch */}
      <mesh material={wallDarkMat} position={[0, GATE_H + lintelH / 2 + 2, 0]}>
        <boxGeometry args={[gap * 2 + TOWER_W * 2, lintelH + 4, surroundT]} />
      </mesh>
      {/* stone jambs framing the opening */}
      {[-1, 1].map((s) => (
        <mesh key={`jamb-${s}`} material={stoneShadeMat} position={[s * (GATE_W / 2 + 1.6), GATE_H / 2, 0]}>
          <boxGeometry args={[3.2, GATE_H, surroundT]} />
        </mesh>
      ))}
      {/* arched voussoir surround over the opening */}
      {Array.from({ length: archSteps }).map((_, i) => {
        const t = (i + 0.5) / archSteps
        const w = GATE_W + 6 - Math.sin(t * Math.PI) * (GATE_W * 0.42)
        const y = GATE_H - 1 + i * 1.6
        return (
          <mesh key={`arch-${i}`} material={i % 2 === 0 ? stoneMat : stoneShadeMat} position={[0, y, 0]}>
            <boxGeometry args={[w, 2, surroundT + 0.4]} />
          </mesh>
        )
      })}
      {/* keystone */}
      <mesh material={stoneShadeMat} position={[0, GATE_H + archSteps * 1.6, 0]}>
        <boxGeometry args={[4, 4, surroundT + 0.8]} />
      </mesh>
      {showDoors && <GateDoors />}
    </group>
  )
}

// Backwards-compatible alias — other district gates render as full gatehouses.
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
  return <Gatehouse center={center} yaw={yaw} />
}

// ---------------------------------------------------------------------------
// breakable-gate debris: opaque wood splinters + stone chunks, ballistic
// with precomputed analytic landing time (scrub-safe: pure function of age).
// ---------------------------------------------------------------------------
type ChunkKind = 'wood' | 'stone'

interface Chunk {
  p0: THREE.Vector3
  v: THREE.Vector3
  scale: THREE.Vector3
  tLand: number
  land: THREE.Vector3
  axis: THREE.Vector3
  spin: number
  kind: ChunkKind
}

const G = 25 // gravity accel used both for tLand solve and integration (a=G/2 per t^2)

function buildChunks(seed: number): Chunk[] {
  const rand = mulberry32(seed)
  const chunks: Chunk[] = []
  // WOOD splinters — long thin boxes launched from the door plane
  for (let i = 0; i < 40; i++) {
    const len = range(rand, 3, 9)
    const scale = new THREE.Vector3(range(rand, 0.4, 0.9), range(rand, 0.4, 0.9), len)
    const p0 = new THREE.Vector3(
      range(rand, -GATE_W / 2, GATE_W / 2),
      range(rand, 2, GATE_H),
      range(rand, -1, 1),
    )
    // smashed from outside — flies inward (-z local) and up
    const v = new THREE.Vector3(range(rand, -11, 11), range(rand, 4, 17), -range(rand, 9, 38))
    const rest = 0.6
    const tLand = (v.y + Math.sqrt(v.y * v.y + 2 * G * Math.max(0.1, p0.y - rest))) / G
    const land = new THREE.Vector3(p0.x + v.x * tLand, rest, p0.z + v.z * tLand)
    const axis = new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize()
    chunks.push({ p0, v, scale, tLand, land, axis, spin: range(rand, 2, 8), kind: 'wood' })
  }
  // STONE chunks — irregular grey blocks from the arch rim
  for (let i = 0; i < 34; i++) {
    const s = range(rand, 1, 6)
    const scale = new THREE.Vector3(s * range(rand, 0.6, 1), s * range(rand, 0.6, 1), s * range(rand, 0.6, 1))
    const p0 = new THREE.Vector3(
      range(rand, -(GATE_W / 2 + 8), GATE_W / 2 + 8),
      range(rand, GATE_H * 0.5, WALL_H - 2),
      range(rand, -WALL_T / 2, WALL_T / 2),
    )
    const v = new THREE.Vector3(range(rand, -9, 9), range(rand, 2, 13), -range(rand, 5, 30))
    const rest = Math.max(...scale.toArray()) / 2
    const tLand = (v.y + Math.sqrt(v.y * v.y + 2 * G * Math.max(0.1, p0.y - rest))) / G
    const land = new THREE.Vector3(p0.x + v.x * tLand, rest, p0.z + v.z * tLand)
    const axis = new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize()
    chunks.push({ p0, v, scale, tLand, land, axis, spin: range(rand, 1, 5), kind: 'stone' })
  }
  return chunks
}

const tmpObj = new THREE.Object3D()
const tmpQuat = new THREE.Quaternion()

function DebrisField({ chunks, kind, ageRef }: { chunks: Chunk[]; kind: ChunkKind; ageRef: { age: number } }) {
  const list = useMemo(() => chunks.filter((c) => c.kind === kind), [chunks, kind])
  const ref = useRef<THREE.InstancedMesh>(null)
  useFrame(() => {
    const mesh = ref.current
    if (!mesh) return
    const age = ageRef.age
    if (age < 0) {
      mesh.visible = false
      return
    }
    mesh.visible = true
    for (let i = 0; i < list.length; i++) {
      const c = list[i]
      const t = Math.min(age, c.tLand)
      if (age >= c.tLand) {
        tmpObj.position.copy(c.land)
      } else {
        tmpObj.position.set(
          c.p0.x + c.v.x * t,
          c.p0.y + c.v.y * t - (G / 2) * t * t,
          c.p0.z + c.v.z * t,
        )
      }
      tmpQuat.setFromAxisAngle(c.axis, c.spin * t)
      tmpObj.quaternion.copy(tmpQuat)
      tmpObj.scale.copy(c.scale)
      tmpObj.updateMatrix()
      mesh.setMatrixAt(i, tmpObj.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
  })
  return (
    <instancedMesh
      ref={ref}
      args={[unitBox, kind === 'wood' ? woodChunkMat : stoneChunkMat, list.length]}
    />
  )
}

// ---------------------------------------------------------------------------
// Persistent rubble heap at the threshold + jagged broken rim (age > 0.4).
// Static, deterministic pile of overlapping opaque chunks.
// ---------------------------------------------------------------------------
interface RubbleItem {
  pos: [number, number, number]
  scale: [number, number, number]
  rot: THREE.Quaternion
  kind: ChunkKind
}

function buildRubble(seed: number): RubbleItem[] {
  const rand = mulberry32(seed ^ 0x9e37)
  const items: RubbleItem[] = []
  // heap at the threshold — mound of overlapping wood + stone
  for (let i = 0; i < 30; i++) {
    const wood = rand() < 0.4
    const x = range(rand, -(GATE_W / 2 + 2), GATE_W / 2 + 2)
    // mound: taller near center, spread inward past the opening
    const rise = Math.max(0, 1 - Math.abs(x) / (GATE_W / 2 + 4))
    const s = wood ? range(rand, 2, 6) : range(rand, 1.5, 5)
    const scale: [number, number, number] = wood
      ? [range(rand, 0.5, 0.9), range(rand, 0.5, 0.9), s]
      : [s * range(rand, 0.6, 1), s * range(rand, 0.5, 0.9), s * range(rand, 0.6, 1)]
    const y = range(rand, 0.4, 2 + rise * 7)
    const z = range(rand, -WALL_T / 2 - 6, WALL_T / 2 + 2)
    const q = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(range(rand, 0, TAU), range(rand, 0, TAU), range(rand, 0, TAU)),
    )
    items.push({ pos: [x, y, z], scale, rot: q, kind: wood ? 'wood' : 'stone' })
  }
  // jagged broken rim — irregular stone chunks clinging to the torn opening edges
  const rimN = 22
  for (let i = 0; i < rimN; i++) {
    // distribute around the opening perimeter (two jambs + arch top)
    const along = rand()
    let x: number
    let y: number
    if (along < 0.66) {
      // side jambs
      const side = rand() < 0.5 ? -1 : 1
      x = side * (GATE_W / 2 + range(rand, -1, 2))
      y = range(rand, 3, GATE_H - 2)
    } else {
      // top arch rim
      x = range(rand, -GATE_W / 2, GATE_W / 2)
      y = GATE_H + range(rand, -2, 3)
    }
    const s = range(rand, 1.5, 5)
    const scale: [number, number, number] = [
      s * range(rand, 0.6, 1.1),
      s * range(rand, 0.6, 1.1),
      WALL_T * range(rand, 0.4, 0.9),
    ]
    const z = range(rand, -1, 1)
    const q = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(range(rand, -0.6, 0.6), range(rand, -0.6, 0.6), range(rand, -0.6, 0.6)),
    )
    items.push({ pos: [x, y, z], scale, rot: q, kind: 'stone' })
  }
  return items
}

function RubbleHeap({ items, kind, ageRef }: { items: RubbleItem[]; kind: ChunkKind; ageRef: { age: number } }) {
  const list = useMemo(() => items.filter((it) => it.kind === kind), [items, kind])
  const ref = useRef<THREE.InstancedMesh>(null)
  const built = useRef(false)
  useFrame(() => {
    const mesh = ref.current
    if (!mesh) return
    const age = ageRef.age
    // only appears once the breach has settled; scrub-safe (pure function of age)
    mesh.visible = age > 0.4
    if (mesh.visible && !built.current) {
      for (let i = 0; i < list.length; i++) {
        const it = list[i]
        tmpObj.position.set(it.pos[0], it.pos[1], it.pos[2])
        tmpObj.quaternion.copy(it.rot)
        tmpObj.scale.set(it.scale[0], it.scale[1], it.scale[2])
        tmpObj.updateMatrix()
        mesh.setMatrixAt(i, tmpObj.matrix)
      }
      mesh.instanceMatrix.needsUpdate = true
      built.current = true
    }
  })
  return (
    <instancedMesh
      ref={ref}
      args={[unitBox, kind === 'wood' ? woodChunkMat : stoneChunkMat, list.length]}
    />
  )
}

// ---------------------------------------------------------------------------
// Expanding, fading dust billboards over ~6s post-breach. Transparency is
// allowed here (dust only). Pure function of age, so backward scrub restores.
// ---------------------------------------------------------------------------
const dustGeo = new THREE.PlaneGeometry(1, 1)

function DustBurst({ seed, ageRef }: { seed: number; ageRef: { age: number } }) {
  const puffs = useMemo(() => {
    const rand = mulberry32(seed ^ 0x51ed)
    return Array.from({ length: 3 }).map(() => ({
      x: range(rand, -GATE_W / 2, GATE_W / 2),
      y: range(rand, 6, GATE_H * 0.7),
      z: range(rand, -WALL_T, 2),
      delay: range(rand, 0, 1),
      rot: range(rand, 0, TAU),
    }))
  }, [seed])
  const mats = useMemo(
    () =>
      puffs.map(
        () =>
          new THREE.MeshBasicMaterial({
            color: '#b8b2a4',
            transparent: true,
            opacity: 0,
            depthWrite: false,
            side: THREE.DoubleSide,
          }),
      ),
    [puffs],
  )
  const refs = useRef<(THREE.Mesh | null)[]>([])
  useFrame(({ camera }) => {
    const age = ageRef.age
    for (let i = 0; i < puffs.length; i++) {
      const m = refs.current[i]
      const p = puffs[i]
      if (!m) continue
      const lt = age - p.delay
      if (age < 0 || lt < 0 || lt > 6) {
        m.visible = false
        continue
      }
      m.visible = true
      const k = lt / 6 // 0..1 lifetime
      const size = 20 + k * 70
      m.scale.set(size, size, 1)
      mats[i].opacity = Math.sin(Math.min(1, k) * Math.PI) * 0.42
      m.position.set(p.x, p.y + k * 18, p.z)
      m.quaternion.copy(camera.quaternion)
    }
  })
  return (
    <>
      {puffs.map((_, i) => (
        <mesh
          key={`dust-${i}`}
          ref={(el) => {
            refs.current[i] = el
          }}
          geometry={dustGeo}
          material={mats[i]}
        />
      ))}
    </>
  )
}

// ---------------------------------------------------------------------------
// A breakable Shiganshina gate. Everything driven by age from getFrame(),
// so forward AND backward scrubbing is a pure function of age.
// ---------------------------------------------------------------------------
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
  const chunks = useMemo(() => buildChunks(seed), [seed])
  const rubble = useMemo(() => buildRubble(seed), [seed])
  const doorsRef = useRef<THREE.Group>(null)
  // shared age handle: written once per frame, read by all debris fields
  const ageRef = useRef({ age: -1 }).current
  useFrame(() => {
    const frame = getFrame()
    ageRef.age = gate === 'outer' ? frame.outerGateAge : frame.innerGateAge
    const broken = gate === 'outer' ? frame.outerGateBroken : frame.innerGateBroken
    // doors vanish on breach; masonry (towers + arch) always stands
    if (doorsRef.current) doorsRef.current.visible = !broken
  })
  return (
    <group position={center} rotation={[0, yaw, 0]}>
      {/* intact masonry stays; only the door group toggles */}
      <Gatehouse center={[0, 0, 0]} yaw={0} showDoors={false} />
      <group ref={doorsRef}>
        <GateDoors />
      </group>
      <DebrisField chunks={chunks} kind="wood" ageRef={ageRef} />
      <DebrisField chunks={chunks} kind="stone" ageRef={ageRef} />
      <RubbleHeap items={rubble} kind="wood" ageRef={ageRef} />
      <RubbleHeap items={rubble} kind="stone" ageRef={ageRef} />
      <DustBurst seed={seed} ageRef={ageRef} />
    </group>
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
