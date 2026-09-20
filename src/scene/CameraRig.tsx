import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import * as THREE from 'three'
import { useParadis } from '../state/store'

const FLY_DUR = 2.4

function smootherstep(x: number): number {
  const t = Math.min(1, Math.max(0, x))
  return t * t * t * (t * (t * 6 - 15) + 10)
}

export function CameraRig() {
  const controls = useRef<OrbitControlsImpl>(null)
  const camera = useThree((s) => s.camera)
  const fly = useRef<{
    t0: number
    fromPos: THREE.Vector3
    fromTarget: THREE.Vector3
    toPos: THREE.Vector3
    toTarget: THREE.Vector3
  } | null>(null)
  const clockRef = useRef(0)

  const flySeq = useParadis((s) => s.flySeq)
  useEffect(() => {
    if (flySeq === 0) return
    const f = useParadis.getState().flyTo
    if (!f || !controls.current) return
    fly.current = {
      t0: clockRef.current,
      fromPos: camera.position.clone(),
      fromTarget: controls.current.target.clone(),
      toPos: new THREE.Vector3(...f.position),
      toTarget: new THREE.Vector3(...f.target),
    }
  }, [flySeq, camera])

  // user interaction cancels an in-flight fly
  useEffect(() => {
    const cancel = () => (fly.current = null)
    window.addEventListener('pointerdown', cancel)
    window.addEventListener('wheel', cancel)
    return () => {
      window.removeEventListener('pointerdown', cancel)
      window.removeEventListener('wheel', cancel)
    }
  }, [])

  useFrame(({ clock }) => {
    clockRef.current = clock.elapsedTime
    const f = fly.current
    if (f && controls.current) {
      const k = smootherstep((clock.elapsedTime - f.t0) / FLY_DUR)
      camera.position.lerpVectors(f.fromPos, f.toPos, k)
      controls.current.target.lerpVectors(f.fromTarget, f.toTarget, k)
      if (k >= 1) fly.current = null
    }
  })

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      target={[0, 0, 2000]}
      enableDamping
      dampingFactor={0.08}
      maxPolarAngle={1.52}
      minDistance={20}
      maxDistance={34000}
      zoomSpeed={1.1}
    />
  )
}
