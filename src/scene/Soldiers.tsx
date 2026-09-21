// Garrison ODM troopers for Episode 2 (Battle of Trost). Everything reads the
// incident frame singleton inside useFrame — no React state, zero per-frame
// allocations (module-scope scratch reused), all randomness seeded at module
// init so the whole battle stays a pure function of frame.t and scrubs exactly.
//
// Four instanced systems, all rendering nothing when frame.id !== 'ep2':
//   1. soldier bodies (capsule + cloak hint + head)
//   2. taut cables (soldier -> anchor while zipping)
//   3. signal flares (rising tracer + drifting smoke column, god-view visible)
//   4. nape kill flashes (crossed slash + sparks, brief)

import { useMemo, useRef, useLayoutEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  InstancedMesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three'
import { getFrame } from '../incidents/driver'
import { mulberry32 } from '../world/rng'
import {
  EP2_SOLDIER_COUNT,
  FLARE_EVENTS,
  NAPE_EVENTS,
  type FlareEvent,
} from '../incidents/ep2'

// ---------------------------------------------------------------------------
// module-scope scratch — reused every frame, never reallocated
// ---------------------------------------------------------------------------
const dummy = new Object3D()
const scratchColor = new Color()
const vA = new Vector3()
const vB = new Vector3()
const vDir = new Vector3()
const quat = new Quaternion()
const UP = new Vector3(0, 1, 0)

const HIDDEN_Y = -1000

function hide(mesh: InstancedMesh, i: number) {
  dummy.position.set(0, HIDDEN_Y, 0)
  dummy.scale.set(0, 0, 0)
  dummy.rotation.set(0, 0, 0)
  dummy.updateMatrix()
  mesh.setMatrixAt(i, dummy.matrix)
}

// soft round particle texture (see Titans.tsx PUFF_TEX) — without it, sprites
// on billboarded quads render as hard squares.
const PUFF_TEX = (() => {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.5, 'rgba(255,255,255,0.55)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  return new CanvasTexture(c)
})()

// ---------------------------------------------------------------------------
// 1. SOLDIER BODIES
// ---------------------------------------------------------------------------
const SOLDIER_COUNT = EP2_SOLDIER_COUNT

const BODY_H = 1.15
const HEAD_R = 0.14
const GARRISON_TAN = '#c9bfa4'
const GARRISON_WHITE = '#e6e0d0'
const CLOAK_GREEN = '#2f4a2c'
const SKIN = ['#c9a785', '#b98f6b', '#d8b48f', '#a97f5c']

interface SoldierTrait {
  body: string
  head: string
  phase: number
}

// ---------------------------------------------------------------------------
// 2. CABLES — one instanced thin cylinder per soldier, spanning soldier->anchor
// ---------------------------------------------------------------------------
// unit cylinder along +Y, height 1, so we can scale Y to the cable length.

// ---------------------------------------------------------------------------
// 3. FLARES
// ---------------------------------------------------------------------------
const FLARE_RISE_DUR = 1.6
const FLARE_APEX = 90 // apex height of the tracer
const FLARE_BASE_Y = 12
const SMOKE_PER_FLARE = 10
const SMOKE_LIFE = 14 // seconds the smoke column persists
const SMOKE_TOP = 60 // how tall the column climbs
const FLARE_WIND = new Vector3(3.5, 0, 1.5) // drift m/s

const FLARE_COLORS: Record<FlareEvent['color'], number> = {
  red: 0xd43a2a,
  green: 0x3aa845,
  yellow: 0xd4b02a,
}
// desaturated smoke tint per flare color
const SMOKE_COLORS: Record<FlareEvent['color'], number> = {
  red: 0xa06a5a,
  green: 0x6a8a60,
  yellow: 0xa89a68,
}

const FLARE_TRACER_COUNT = FLARE_EVENTS.length
const SMOKE_COUNT = FLARE_EVENTS.length * SMOKE_PER_FLARE

// deterministic per-smoke-puff jitter
interface SmokePuff {
  flare: number
  seedX: number
  seedZ: number
  born: number // 0..1 fraction up the column at which it appears / stagger
  size: number
  sway: number
}

// ---------------------------------------------------------------------------
// 4. NAPE KILL FLASHES
// ---------------------------------------------------------------------------
const NAPE_LIFE = 0.5
const NAPE_SPARKS = 8
const NAPE_COLOR = 0xd8ffd0

const NAPE_SLASH_COUNT = NAPE_EVENTS.length * 2 // two crossed quads each
const NAPE_SPARK_COUNT = NAPE_EVENTS.length * NAPE_SPARKS

interface SparkTrait {
  nape: number
  dx: number
  dy: number
  dz: number
  speed: number
}

export function Soldiers() {
  // ---- soldier body refs ----
  const bodyRef = useRef<InstancedMesh>(null)
  const cloakRef = useRef<InstancedMesh>(null)
  const headRef = useRef<InstancedMesh>(null)
  const cableRef = useRef<InstancedMesh>(null)
  // ---- flare refs ----
  const tracerRef = useRef<InstancedMesh>(null)
  const smokeRef = useRef<InstancedMesh>(null)
  // ---- nape refs ----
  const slashRef = useRef<InstancedMesh>(null)
  const sparkRef = useRef<InstancedMesh>(null)

  // seeded traits (built once at mount, deterministic)
  const traits = useMemo<SoldierTrait[]>(() => {
    const rand = mulberry32(0x0d4e)
    const out: SoldierTrait[] = []
    for (let i = 0; i < SOLDIER_COUNT; i++) {
      out.push({
        body: rand() < 0.5 ? GARRISON_TAN : GARRISON_WHITE,
        head: SKIN[Math.floor(rand() * SKIN.length)],
        phase: rand() * Math.PI * 2,
      })
    }
    return out
  }, [])

  const smokePuffs = useMemo<SmokePuff[]>(() => {
    const rand = mulberry32(0x5f0a)
    const out: SmokePuff[] = []
    for (let f = 0; f < FLARE_EVENTS.length; f++) {
      for (let k = 0; k < SMOKE_PER_FLARE; k++) {
        out.push({
          flare: f,
          seedX: (rand() - 0.5) * 2,
          seedZ: (rand() - 0.5) * 2,
          born: k / SMOKE_PER_FLARE,
          size: 10 + rand() * 8,
          sway: rand() * Math.PI * 2,
        })
      }
    }
    return out
  }, [])

  const sparkTraits = useMemo<SparkTrait[]>(() => {
    const rand = mulberry32(0x9a2c)
    const out: SparkTrait[] = []
    for (let n = 0; n < NAPE_EVENTS.length; n++) {
      for (let k = 0; k < NAPE_SPARKS; k++) {
        const a = rand() * Math.PI * 2
        const el = rand() * Math.PI * 2
        out.push({
          nape: n,
          dx: Math.cos(a) * Math.cos(el),
          dy: 0.4 + Math.abs(Math.sin(el)),
          dz: Math.sin(a) * Math.cos(el),
          speed: 6 + rand() * 6,
        })
      }
    }
    return out
  }, [])

  // ---- geometries ----
  const bodyGeo = useMemo(() => new CapsuleGeometry(0.24, BODY_H - 0.5, 4, 8), [])
  const cloakGeo = useMemo(() => new BoxGeometry(0.5, 0.7, 0.12), [])
  const headGeo = useMemo(() => new SphereGeometry(HEAD_R, 8, 6), [])
  const cableGeo = useMemo(() => {
    const g = new CylinderGeometry(0.03, 0.03, 1, 5)
    g.translate(0, 0.5, 0) // base at origin, extends +Y so scale.y = length
    return g
  }, [])
  const tracerGeo = useMemo(() => new SphereGeometry(1.1, 10, 8), [])
  const smokeGeo = useMemo(() => new PlaneGeometry(1, 1), [])
  const slashGeo = useMemo(() => new PlaneGeometry(1, 0.18), [])
  const sparkGeo = useMemo(() => new SphereGeometry(0.35, 6, 5), [])

  // ---- materials ----
  const bodyMat = useMemo(() => new MeshStandardMaterial({ roughness: 0.85, metalness: 0.05 }), [])
  const cloakMat = useMemo(() => new MeshStandardMaterial({ color: CLOAK_GREEN, roughness: 0.9, metalness: 0 }), [])
  const headMat = useMemo(() => new MeshStandardMaterial({ roughness: 0.9, metalness: 0 }), [])
  const cableMat = useMemo(() => new MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.4, metalness: 0.8 }), [])
  const tracerMat = useMemo(
    () => new MeshBasicMaterial({ transparent: true, opacity: 1, blending: AdditiveBlending, depthWrite: false, toneMapped: false }),
    [],
  )
  const smokeMat = useMemo(
    () =>
      new MeshBasicMaterial({
        map: PUFF_TEX,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        side: DoubleSide,
        blending: AdditiveBlending,
        toneMapped: false,
      }),
    [],
  )
  const slashMat = useMemo(
    () =>
      new MeshBasicMaterial({
        color: NAPE_COLOR,
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
        toneMapped: false,
      }),
    [],
  )
  const sparkMat = useMemo(
    () => new MeshBasicMaterial({ color: NAPE_COLOR, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, toneMapped: false }),
    [],
  )

  // bake per-instance colors that don't change
  useLayoutEffect(() => {
    const bm = bodyRef.current
    const hm = headRef.current
    if (bm && hm) {
      for (let i = 0; i < SOLDIER_COUNT; i++) {
        scratchColor.set(traits[i].body)
        bm.setColorAt(i, scratchColor)
        scratchColor.set(traits[i].head)
        hm.setColorAt(i, scratchColor)
      }
      if (bm.instanceColor) bm.instanceColor.needsUpdate = true
      if (hm.instanceColor) hm.instanceColor.needsUpdate = true
    }

    // tracer + smoke per-flare colors
    const tr = tracerRef.current
    if (tr) {
      for (let f = 0; f < FLARE_EVENTS.length; f++) {
        scratchColor.set(FLARE_COLORS[FLARE_EVENTS[f].color])
        tr.setColorAt(f, scratchColor)
      }
      if (tr.instanceColor) tr.instanceColor.needsUpdate = true
    }
    const sm = smokeRef.current
    if (sm) {
      for (let i = 0; i < smokePuffs.length; i++) {
        scratchColor.set(SMOKE_COLORS[FLARE_EVENTS[smokePuffs[i].flare].color])
        sm.setColorAt(i, scratchColor)
      }
      if (sm.instanceColor) sm.instanceColor.needsUpdate = true
    }
  }, [traits, smokePuffs])

  useFrame((state) => {
    const frame = getFrame()
    const time = state.clock.elapsedTime
    const t = frame.t
    const active = frame.id === 'ep2'

    const bm = bodyRef.current
    const cm = cloakRef.current
    const hm = headRef.current
    const cbm = cableRef.current
    const trm = tracerRef.current
    const smm = smokeRef.current
    const slm = slashRef.current
    const spm = sparkRef.current
    if (!bm || !cm || !hm || !cbm || !trm || !smm || !slm || !spm) return

    // ---------------------------------------------------------------------
    // 1 + 2. soldier bodies + cables
    // ---------------------------------------------------------------------
    const soldiers = frame.soldiers
    for (let i = 0; i < SOLDIER_COUNT; i++) {
      const s = active ? soldiers[i] : undefined
      const tr = traits[i]

      if (!s || s.mode === 'gone') {
        hide(bm, i)
        hide(cm, i)
        hide(hm, i)
        hide(cbm, i)
        continue
      }

      const x = s.pos[0]
      const y = s.pos[1]
      const z = s.pos[2]

      // per-mode body pose
      let pitch = 0 // forward lean about X
      let roll = 0
      let bodyY = y + BODY_H / 2
      let lying = false

      if (s.mode === 'zip') {
        pitch = 0.61 // ~35deg forward along travel
        const bob = Math.sin(time * 10 + tr.phase) * 0.04
        bodyY += bob
      } else if (s.mode === 'stand') {
        const sway = Math.sin(time * 1.6 + tr.phase) * 0.03
        pitch = 0.05
        roll = sway
      } else if (s.mode === 'dead') {
        // lying flat on the ground
        lying = true
        bodyY = 0.25
      }

      // body
      dummy.position.set(x, bodyY, z)
      if (lying) {
        dummy.rotation.set(Math.PI / 2, s.yaw, 0)
      } else {
        dummy.rotation.set(pitch, s.yaw, roll)
      }
      dummy.scale.set(1, 1, 1)
      dummy.updateMatrix()
      bm.setMatrixAt(i, dummy.matrix)

      // cloak hint — small box behind the back, riding the same transform
      if (lying) {
        dummy.position.set(x, 0.28, z)
        dummy.rotation.set(Math.PI / 2, s.yaw, 0)
        dummy.updateMatrix()
        cm.setMatrixAt(i, dummy.matrix)
      } else {
        // offset behind the torso: local -Z, rotated by yaw
        const back = 0.22
        const bx = x - Math.sin(s.yaw) * back
        const bz = z - Math.cos(s.yaw) * back
        dummy.position.set(bx, bodyY + 0.05, bz)
        dummy.rotation.set(pitch, s.yaw, roll)
        dummy.scale.set(1, 1, 1)
        dummy.updateMatrix()
        cm.setMatrixAt(i, dummy.matrix)
      }

      // head — rides on top of the body, following pitch
      if (lying) {
        const hx = x + Math.sin(s.yaw) * (BODY_H * 0.5)
        const hz = z + Math.cos(s.yaw) * (BODY_H * 0.5)
        dummy.position.set(hx, 0.3, hz)
      } else {
        const headY = y + BODY_H + HEAD_R
        // lean shifts the head forward along facing when pitched
        const lead = Math.sin(pitch) * (BODY_H * 0.5)
        dummy.position.set(x + Math.sin(s.yaw) * lead, headY, z + Math.cos(s.yaw) * lead)
      }
      dummy.rotation.set(lying ? Math.PI / 2 : pitch, s.yaw, roll)
      dummy.scale.set(1, 1, 1)
      dummy.updateMatrix()
      hm.setMatrixAt(i, dummy.matrix)

      // cable — only while zipping with a real anchor
      if (s.mode === 'zip' && s.anchor[1] >= 0) {
        // grapple leaves from roughly the soldier's upper back
        vA.set(x, bodyY + 0.4, z)
        vB.set(s.anchor[0], s.anchor[1], s.anchor[2])
        vDir.subVectors(vB, vA)
        const len = vDir.length()
        if (len > 0.001) {
          quat.setFromUnitVectors(UP, vDir.normalize())
          dummy.position.copy(vA)
          dummy.quaternion.copy(quat)
          dummy.scale.set(1, len, 1)
          dummy.updateMatrix()
          cbm.setMatrixAt(i, dummy.matrix)
        } else {
          hide(cbm, i)
        }
      } else {
        hide(cbm, i)
      }
    }
    bm.instanceMatrix.needsUpdate = true
    cm.instanceMatrix.needsUpdate = true
    hm.instanceMatrix.needsUpdate = true
    cbm.instanceMatrix.needsUpdate = true

    // ---------------------------------------------------------------------
    // 3. flares — tracer sphere + smoke column, deterministic in t
    // ---------------------------------------------------------------------
    const trMat = trm.material as MeshBasicMaterial
    // opacity has to be shared across instances; use a mid value and let the
    // per-instance scale/position do the hiding (scale 0 = invisible).
    trMat.opacity = 1
    for (let f = 0; f < FLARE_EVENTS.length; f++) {
      const ev = FLARE_EVENTS[f]
      const age = active ? t - ev.t0 : -1
      if (age < 0 || age > FLARE_RISE_DUR + 0.4) {
        hide(trm, f)
        continue
      }
      const rise = Math.min(1, age / FLARE_RISE_DUR)
      // ease-out climb
      const climb = 1 - (1 - rise) * (1 - rise)
      const y = FLARE_BASE_Y + climb * (FLARE_APEX - FLARE_BASE_Y)
      // flicker + fade as it reaches apex
      const flick = 0.8 + 0.2 * Math.sin(time * 40 + f)
      const fade = age > FLARE_RISE_DUR ? Math.max(0, 1 - (age - FLARE_RISE_DUR) / 0.4) : 1
      const sc = (1.4 + climb * 0.6) * flick * (0.4 + fade * 0.6)
      dummy.position.set(ev.x, y, ev.z)
      dummy.rotation.set(0, 0, 0)
      dummy.scale.setScalar(sc)
      dummy.updateMatrix()
      trm.setMatrixAt(f, dummy.matrix)
    }
    trm.instanceMatrix.needsUpdate = true

    // smoke column — billboarded quads rising, expanding, fading, drifting
    const camPos = state.camera.position
    for (let i = 0; i < smokePuffs.length; i++) {
      const pf = smokePuffs[i]
      const ev = FLARE_EVENTS[pf.flare]
      // smoke starts once the tracer is airborne
      const age = active ? t - (ev.t0 + FLARE_RISE_DUR + pf.born * 1.2) : -1
      if (age < 0 || age > SMOKE_LIFE) {
        hide(smm, i)
        continue
      }
      const life = age / SMOKE_LIFE // 0..1
      // rise up the column (climbs toward SMOKE_TOP), ease-out
      const climb = 1 - (1 - life) * (1 - life)
      const y = FLARE_APEX * 0.35 + climb * SMOKE_TOP
      // widen the plume as it climbs; drift with wind + gentle sway
      const spread = 4 + climb * 22
      const sway = Math.sin(time * 0.7 + pf.sway) * (2 + climb * 4)
      const wx = ev.x + pf.seedX * spread + FLARE_WIND.x * age * (0.4 + climb) + sway
      const wz = ev.z + pf.seedZ * spread + FLARE_WIND.z * age * (0.4 + climb)
      // fade in fast, out slow
      const fadeIn = Math.min(1, age / 0.6)
      const fadeOut = 1 - life
      const alpha = fadeIn * fadeOut
      const size = pf.size * (0.6 + climb * 1.6)

      dummy.position.set(wx, y, wz)
      // billboard toward camera
      vA.set(wx, y, wz)
      dummy.lookAt(camPos.x, camPos.y, camPos.z)
      // encode alpha into scale so a shared-opacity material still fades:
      // fully faded puffs shrink to nothing.
      dummy.scale.setScalar(size * (0.15 + alpha))
      dummy.updateMatrix()
      smm.setMatrixAt(i, dummy.matrix)
    }
    // shared opacity kept generous; per-instance scale carries most of the fade
    ;(smm.material as MeshBasicMaterial).opacity = 0.55
    smm.instanceMatrix.needsUpdate = true

    // ---------------------------------------------------------------------
    // 4. nape kill flashes — crossed slashes + sparks, deterministic in t
    // ---------------------------------------------------------------------
    for (let n = 0; n < NAPE_EVENTS.length; n++) {
      const ev = NAPE_EVENTS[n]
      const age = active ? t - ev.t : -1
      const alive = age >= 0 && age <= NAPE_LIFE
      // flare up then vanish
      const p = alive ? age / NAPE_LIFE : 0
      const flash = alive ? Math.sin(p * Math.PI) : 0
      const size = alive ? 4 + p * 6 : 0

      for (let c = 0; c < 2; c++) {
        const idx = n * 2 + c
        if (!alive) {
          hide(slm, idx)
          continue
        }
        // two crossed quads: one at +45deg, one at -45deg, in the plane facing +Z
        const rz = c === 0 ? Math.PI / 4 : -Math.PI / 4
        dummy.position.set(ev.x, ev.y, ev.z)
        dummy.rotation.set(0, 0, rz)
        dummy.scale.set(size, size * (0.6 + flash), 1)
        dummy.updateMatrix()
        slm.setMatrixAt(idx, dummy.matrix)
      }
    }
    ;(slm.material as MeshBasicMaterial).opacity = 0.9
    slm.instanceMatrix.needsUpdate = true

    // sparks fly out and fall
    for (let i = 0; i < sparkTraits.length; i++) {
      const sp = sparkTraits[i]
      const ev = NAPE_EVENTS[sp.nape]
      const age = active ? t - ev.t : -1
      if (age < 0 || age > NAPE_LIFE + 0.3) {
        hide(spm, i)
        continue
      }
      const life = age / (NAPE_LIFE + 0.3)
      const dist = sp.speed * age
      const gx = ev.x + sp.dx * dist
      const gy = ev.y + sp.dy * dist - 9.8 * age * age // slight gravity
      const gz = ev.z + sp.dz * dist
      const sc = (0.5 + (1 - life) * 0.8) * (life < 0.9 ? 1 : (1 - life) / 0.1)
      dummy.position.set(gx, Math.max(0.1, gy), gz)
      dummy.rotation.set(0, 0, 0)
      dummy.scale.setScalar(Math.max(0, sc))
      dummy.updateMatrix()
      spm.setMatrixAt(i, dummy.matrix)
    }
    ;(spm.material as MeshBasicMaterial).opacity = 0.95
    spm.instanceMatrix.needsUpdate = true
  })

  return (
    <group>
      {/* soldier bodies */}
      <instancedMesh
        ref={bodyRef}
        args={[bodyGeo, bodyMat, SOLDIER_COUNT]}
        castShadow
        frustumCulled={false}
      />
      <instancedMesh
        ref={cloakRef}
        args={[cloakGeo, cloakMat, SOLDIER_COUNT]}
        frustumCulled={false}
      />
      <instancedMesh
        ref={headRef}
        args={[headGeo, headMat, SOLDIER_COUNT]}
        castShadow
        frustumCulled={false}
      />
      {/* cables */}
      <instancedMesh
        ref={cableRef}
        args={[cableGeo, cableMat, SOLDIER_COUNT]}
        frustumCulled={false}
      />
      {/* flare tracers */}
      <instancedMesh
        ref={tracerRef}
        args={[tracerGeo, tracerMat, FLARE_TRACER_COUNT]}
        frustumCulled={false}
      />
      {/* flare smoke columns */}
      <instancedMesh
        ref={smokeRef}
        args={[smokeGeo, smokeMat, SMOKE_COUNT]}
        frustumCulled={false}
      />
      {/* nape slash flashes */}
      <instancedMesh
        ref={slashRef}
        args={[slashGeo, slashMat, NAPE_SLASH_COUNT]}
        frustumCulled={false}
      />
      {/* nape sparks */}
      <instancedMesh
        ref={sparkRef}
        args={[sparkGeo, sparkMat, NAPE_SPARK_COUNT]}
        frustumCulled={false}
      />
    </group>
  )
}
