import { Suspense, useEffect, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { CameraRig } from './scene/CameraRig'
import { Island } from './scene/Island'
import { Walls } from './scene/Walls'
import { Districts } from './scene/Districts'
import { Town } from './scene/Town'
import { People } from './scene/People'
import { Titans } from './scene/Titans'
import { IncidentDriver, getFrame } from './incidents/driver'
import { HUD } from './ui/HUD'

/** camera shake applied to the whole world group — avoids fighting OrbitControls */
function ShakeWorld({ children }: { children: React.ReactNode }) {
  const ref = useRef<THREE.Group>(null)
  useFrame(({ clock }) => {
    if (!ref.current) return
    const s = getFrame().shake
    if (s > 0.005) {
      const t = clock.elapsedTime
      ref.current.position.set(
        Math.sin(t * 61.7) * s * 6,
        Math.sin(t * 83.3 + 1.3) * s * 4,
        Math.sin(t * 71.9 + 2.6) * s * 6,
      )
    } else {
      ref.current.position.set(0, 0, 0)
    }
  })
  return <group ref={ref}>{children}</group>
}

/** white lightning flash — DOM overlay driven by rAF outside React state */
function FlashOverlay() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let raf = 0
    const tick = () => {
      if (ref.current) {
        ref.current.style.opacity = String(getFrame().flash * 0.9)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        inset: 0,
        background: '#fff8e8',
        opacity: 0,
        pointerEvents: 'none',
        zIndex: 40,
      }}
    />
  )
}

export default function App() {
  return (
    <>
      <Canvas
        gl={{ antialias: true, logarithmicDepthBuffer: true }}
        camera={{ position: [0, 10000, 24000], fov: 45, near: 2, far: 90000 }}
        onCreated={({ scene }) => {
          scene.background = new THREE.Color('#b9cedb')
          scene.fog = new THREE.Fog('#c2d3dc', 13000, 55000)
        }}
      >
        <hemisphereLight args={['#d3e2ec', '#57614b', 0.95]} />
        <directionalLight position={[9000, 11000, 5000]} intensity={1.7} color="#fff1da" />
        <IncidentDriver />
        <CameraRig />
        <ShakeWorld>
          <Island />
          <Walls />
          <Suspense fallback={null}>
            <Districts />
          </Suspense>
          <Town />
          <People />
          <Titans />
        </ShakeWorld>
      </Canvas>
      <HUD />
      <FlashOverlay />
    </>
  )
}
