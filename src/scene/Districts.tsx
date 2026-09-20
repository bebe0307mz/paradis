import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Billboard, Text } from '@react-three/drei'
import * as THREE from 'three'
import {
  DISTRICTS,
  DISTRICT_R,
  MARIA_R,
  ROSE_R,
  SINA_R,
  districtGateCenter,
  districtOutward,
} from '../world/constants'
import { useParadis } from '../state/store'

const LABEL_COLOR = '#f4ede0'
const OUTLINE = '#1d1a14'

function DistrictLabel({ index }: { index: number }) {
  const dd = DISTRICTS[index]
  const requestFly = useParadis((s) => s.requestFly)
  if (!dd.named) return null
  const c = districtGateCenter(dd)
  const o = districtOutward(dd)
  const pos: [number, number, number] = [c[0] + o[0] * DISTRICT_R * 0.5, 230, c[2] + o[2] * DISTRICT_R * 0.5]
  return (
    <Billboard position={pos}>
      <Text
        fontSize={dd.id === 'shiganshina' ? 110 : 90}
        color={LABEL_COLOR}
        outlineWidth={5}
        outlineColor={OUTLINE}
        letterSpacing={0.12}
        onClick={(e) => {
          e.stopPropagation()
          requestFly({
            target: [c[0] + o[0] * 250, 30, c[2] + o[2] * 250],
            position: [c[0] + o[0] * (DISTRICT_R + 1000) + 300, 520, c[2] + o[2] * (DISTRICT_R + 1000)],
          })
        }}
        onPointerOver={() => (document.body.style.cursor = 'pointer')}
        onPointerOut={() => (document.body.style.cursor = 'auto')}
      >
        {dd.name.toUpperCase()}
      </Text>
    </Billboard>
  )
}

function WallLabel({ text, r }: { text: string; r: number }) {
  const a = Math.PI / 4
  return (
    <Billboard position={[Math.sin(a) * r, 420, Math.cos(a) * r]}>
      <Text
        fontSize={230}
        color="#e8dfcb"
        outlineWidth={8}
        outlineColor={OUTLINE}
        letterSpacing={0.25}
        fillOpacity={0.85}
      >
        {text}
      </Text>
    </Billboard>
  )
}

/** pulsing incident marker over the Shiganshina outer gate */
function IncidentPin() {
  const incident = useParadis((s) => s.incident)
  const startIncident = useParadis((s) => s.startIncident)
  const requestFly = useParadis((s) => s.requestFly)
  const ring = useRef<THREE.Mesh>(null)
  const group = useRef<THREE.Group>(null)
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    if (ring.current) {
      const s = 1 + 0.35 * (0.5 + 0.5 * Math.sin(t * 3.2))
      ring.current.scale.setScalar(s)
      const m = ring.current.material as THREE.MeshBasicMaterial
      m.opacity = 0.75 - 0.4 * (0.5 + 0.5 * Math.sin(t * 3.2))
    }
    if (group.current) group.current.position.y = 150 + Math.sin(t * 1.6) * 12
  })
  if (incident) return null
  const begin = (e: { stopPropagation: () => void }) => {
    e.stopPropagation()
    startIncident('ep1')
    requestFly({ target: [0, 45, 12480], position: [390, 230, 13230] })
  }
  return (
    <group ref={group} position={[0, 150, MARIA_R + DISTRICT_R]}>
      <Billboard>
        <mesh
          onClick={begin}
          onPointerOver={() => (document.body.style.cursor = 'pointer')}
          onPointerOut={() => (document.body.style.cursor = 'auto')}
        >
          <circleGeometry args={[46, 32]} />
          <meshBasicMaterial color="#8e2f24" transparent opacity={0.92} />
        </mesh>
        <mesh ref={ring} position={[0, 0, -1]}>
          <ringGeometry args={[52, 60, 40]} />
          <meshBasicMaterial color="#8e2f24" transparent opacity={0.6} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[6, 0, 1]} onClick={begin}>
          <circleGeometry args={[20, 3]} />
          <meshBasicMaterial color="#f4ede0" />
        </mesh>
        <Text position={[0, 92, 0]} fontSize={40} color="#f4ede0" outlineWidth={2.5} outlineColor={OUTLINE} letterSpacing={0.18}>
          YEAR 845 — THE FALL
        </Text>
      </Billboard>
    </group>
  )
}

export function Districts() {
  return (
    <group>
      {DISTRICTS.map((_, i) => (
        <DistrictLabel key={i} index={i} />
      ))}
      <WallLabel text="WALL MARIA" r={MARIA_R} />
      <WallLabel text="WALL ROSE" r={ROSE_R} />
      <WallLabel text="WALL SINA" r={SINA_R} />
      <Billboard position={[0, 320, 0]}>
        <Text fontSize={95} color={LABEL_COLOR} outlineWidth={5} outlineColor={OUTLINE} letterSpacing={0.14}>
          MITRAS
        </Text>
      </Billboard>
      <IncidentPin />
    </group>
  )
}
