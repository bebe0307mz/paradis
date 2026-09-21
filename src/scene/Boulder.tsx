// The Trost boulder — rendered from frame.boulder (Episode 2 only). The
// timeline owns its position (resting → hoisted overhead → slammed into the
// breach); this component just draws the rock and the slam dust.

import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { getFrame } from '../incidents/driver'
import { mulberry32 } from '../world/rng'
import { EP2_T_SLAM } from '../incidents/ep2'
import { TRO_OUTER_GATE } from '../world/constants'

const DUST_N = 5

export function Boulder() {
  const rockRef = useRef<THREE.Mesh>(null)
  const dustRef = useRef<THREE.InstancedMesh>(null)

  const rockGeo = useMemo(() => {
    const g = new THREE.IcosahedronGeometry(1, 1)
    const rand = mulberry32(77)
    const pos = g.getAttribute('position') as THREE.BufferAttribute
    // jitter vertices for a craggy read (icosahedron shares no vertices at
    // detail 1 with flat shading, so seams are fine)
    for (let i = 0; i < pos.count; i++) {
      pos.setXYZ(
        i,
        pos.getX(i) * (0.85 + rand() * 0.35),
        pos.getY(i) * (0.8 + rand() * 0.35),
        pos.getZ(i) * (0.85 + rand() * 0.35),
      )
    }
    g.computeVertexNormals()
    return g
  }, [])

  const dusts = useMemo(() => {
    const rand = mulberry32(78)
    return Array.from({ length: DUST_N }, () => ({
      dx: (rand() - 0.5) * 30,
      dy: 3 + rand() * 14,
      grow: 14 + rand() * 22,
      spin: rand() * Math.PI,
    }))
  }, [])

  const dummy = useMemo(() => new THREE.Object3D(), [])

  useFrame(() => {
    const frame = getFrame()
    const rock = rockRef.current
    const dust = dustRef.current
    if (!rock || !dust) return
    const b = frame.boulder
    const show = frame.id === 'ep2' && !!b && b.visible
    rock.visible = show
    if (show && b) {
      rock.position.set(b.pos[0], b.pos[1], b.pos[2])
      // held: a slight strained wobble
      const wob = b.held ? Math.sin(frame.t * 5.1) * 0.04 : 0
      rock.rotation.set(0.3 + wob, 0.8, 0.1 - wob)
      rock.scale.set(9.5, 7.5, 8.5)
    }

    // slam dust: expanding fading discs at the breach
    const age = frame.id === 'ep2' ? frame.t - EP2_T_SLAM - 0.5 : -1
    for (let i = 0; i < DUST_N; i++) {
      const d = dusts[i]
      const life = age >= 0 ? age / 5 : -1
      if (life < 0 || life > 1) {
        dummy.position.set(0, -1000, 0)
        dummy.scale.setScalar(0)
      } else {
        dummy.position.set(d.dx * (0.4 + life), d.dy + life * 16, TRO_OUTER_GATE[2] - 18)
        dummy.scale.setScalar(d.grow * (0.25 + life))
        dummy.rotation.set(0, 0, d.spin + life * 0.6)
      }
      dummy.updateMatrix()
      dust.setMatrixAt(i, dummy.matrix)
    }
    dust.instanceMatrix.needsUpdate = true
    const mat = dust.material as THREE.MeshBasicMaterial
    mat.opacity = age >= 0 && age < 5 ? 0.42 * (1 - age / 5) : 0
  })

  return (
    <group>
      <mesh ref={rockRef} geometry={rockGeo} visible={false}>
        <meshStandardMaterial color="#8d8577" roughness={0.97} flatShading />
      </mesh>
      <instancedMesh ref={dustRef} args={[undefined, undefined, DUST_N]} frustumCulled={false}>
        <circleGeometry args={[1, 20]} />
        <meshBasicMaterial color="#b0a795" transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
      </instancedMesh>
    </group>
  )
}
