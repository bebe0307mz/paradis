import { Suspense, useEffect, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { CameraRig } from './scene/CameraRig'
import { Island } from './scene/Island'
import { Walls } from './scene/Walls'
import { Districts } from './scene/Districts'
import { Town } from './scene/Town'
import { People } from './scene/People'
import { Titans } from './scene/Titans'
import { Gore } from './scene/Gore'
import { Fires } from './scene/Fires'
import { Soldiers } from './scene/Soldiers'
import { Boulder } from './scene/Boulder'
import { Impacts } from './scene/Impacts'
import { IncidentDriver, getFrame } from './incidents/driver'
import { KILL_EVENTS, FIRE_SPOTS } from './incidents/ep1'
import { EP2_KILL_EVENTS, EP2_FIRE_SPOTS } from './incidents/ep2'
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

// color grading: the world slides from pastoral daylight into smoke and embers
// as frame.atmosphere ramps 0 → 1 after the breach
const CALM = {
  bg: new THREE.Color('#b9cedb'),
  fog: new THREE.Color('#c2d3dc'),
  hemiSky: new THREE.Color('#d3e2ec'),
  hemiGround: new THREE.Color('#57614b'),
  sun: new THREE.Color('#fff1da'),
}
const HELL = {
  bg: new THREE.Color('#6d564b'),
  fog: new THREE.Color('#6a5449'),
  hemiSky: new THREE.Color('#8a7062'),
  hemiGround: new THREE.Color('#382f28'),
  sun: new THREE.Color('#ff9d5c'),
}
const tmpA = new THREE.Color()

function Atmosphere() {
  const scene = useThree((s) => s.scene)
  const hemi = useRef<THREE.HemisphereLight>(null)
  const sun = useRef<THREE.DirectionalLight>(null)
  const fogRef = useRef<THREE.Fog | null>(null)

  useEffect(() => {
    scene.background = CALM.bg.clone()
    fogRef.current = new THREE.Fog(CALM.fog.clone(), 13000, 55000)
    scene.fog = fogRef.current
  }, [scene])

  useFrame(() => {
    const a = getFrame().atmosphere
    if (scene.background instanceof THREE.Color) {
      scene.background.copy(tmpA.copy(CALM.bg).lerp(HELL.bg, a))
    }
    const fog = fogRef.current
    if (fog) {
      fog.color.copy(tmpA.copy(CALM.fog).lerp(HELL.fog, a))
      fog.near = 13000 - a * 5500
      fog.far = 55000 - a * 16000
    }
    if (hemi.current) {
      hemi.current.color.copy(tmpA.copy(CALM.hemiSky).lerp(HELL.hemiSky, a))
      hemi.current.groundColor.copy(tmpA.copy(CALM.hemiGround).lerp(HELL.hemiGround, a))
      hemi.current.intensity = 0.95 - a * 0.3
    }
    if (sun.current) {
      sun.current.color.copy(tmpA.copy(CALM.sun).lerp(HELL.sun, a))
      sun.current.intensity = 1.7 - a * 0.55
    }
  })

  return (
    <>
      <hemisphereLight ref={hemi} args={['#d3e2ec', '#57614b', 0.95]} />
      <directionalLight ref={sun} position={[9000, 11000, 5000]} intensity={1.7} color="#fff1da" />
      {/* northern fill so north-facing facades and the gate doors never crush to black */}
      <directionalLight position={[-6000, 7000, -9000]} intensity={0.4} color="#cdd6de" />
    </>
  )
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

/** red vignette that pulses with each kill and thickens as the district burns */
function BloodVignette() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let raf = 0
    const tick = () => {
      if (ref.current) {
        const f = getFrame()
        let pulse = 0
        if (f.active) {
          const events = f.id === 'ep2' ? EP2_KILL_EVENTS : KILL_EVENTS
          for (const k of events) {
            const since = f.t - k.t
            if (since >= 0 && since < 2.4) pulse += Math.exp(-since / 0.7) * 0.35
          }
        }
        const o = Math.min(0.55, (f.active ? f.atmosphere * 0.16 : 0) + pulse)
        ref.current.style.opacity = String(o)
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
        background:
          'radial-gradient(ellipse at center, rgba(0,0,0,0) 52%, rgba(96,6,6,0.55) 88%, rgba(64,2,2,0.8) 100%)',
        opacity: 0,
        pointerEvents: 'none',
        zIndex: 39,
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
      >
        <Atmosphere />
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
          <Soldiers />
          <Boulder />
          <Impacts />
          <Gore events={KILL_EVENTS} forId="ep1" />
          <Gore events={EP2_KILL_EVENTS} forId="ep2" />
          <Fires spots={FIRE_SPOTS} forId="ep1" />
          <Fires spots={EP2_FIRE_SPOTS} forId="ep2" />
        </ShakeWorld>
      </Canvas>
      <HUD />
      <BloodVignette />
      <FlashOverlay />
    </>
  )
}
