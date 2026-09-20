// Procedural Attack-on-Titan cast, rendered every frame from the incident
// frame singleton (../incidents/driver). NOTHING here goes through React state:
// the scene graph is built once from JSX/useMemo and animated exclusively via
// refs inside useFrame, copying values out of the (mutated-in-place) frame.

import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { getFrame } from '../incidents/driver.ts'
import { mulberry32 } from '../world/rng.ts'
import type { TitanState } from '../world/types.ts'

// ---------------------------------------------------------------------------
// Shared geometry — a single unit box / sphere / cylinder scaled per limb keeps
// draw calls proportional to titan count rather than to limb count would-be.
// (These are cheap and reused across every titan; materials vary per body.)
// ---------------------------------------------------------------------------
const BOX = new THREE.BoxGeometry(1, 1, 1)
const SPHERE = new THREE.SphereGeometry(0.5, 16, 12)
const CIRCLE = new THREE.CircleGeometry(1, 24)

// Small helper: a MeshStandardMaterial with our house defaults.
function mat(color: THREE.ColorRepresentation, opts?: Partial<THREE.MeshStandardMaterialParameters>) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...opts })
}

// A limb pivot: an inner mesh offset so the group can rotate about a joint.
// `len` is along -Y (hangs down) for legs/arms; the mesh is centred at -len/2.
type Limb = { pivot: THREE.Group; mesh: THREE.Mesh }
function makeLimb(material: THREE.Material, w: number, len: number, d: number): Limb {
  const pivot = new THREE.Group()
  const mesh = new THREE.Mesh(BOX, material)
  mesh.scale.set(w, len, d)
  mesh.position.y = -len / 2
  pivot.add(mesh)
  return { pivot, mesh }
}

// ===========================================================================
// PURE TITAN
// ===========================================================================
// Grotesque naked humanoid: oversized head, potbelly, dangling arms. All
// proportions derive from `height` so the same rig covers 4–15m titans.
type PureRig = {
  root: THREE.Group
  body: THREE.Group // everything above the feet — receives the bob/roll
  head: THREE.Group
  torso: THREE.Mesh
  arms: [Limb, Limb]
  legs: [Limb, Limb]
  flash: THREE.Mesh // crimson consume puff
  shadow: THREE.Mesh
  height: number
  phase: number // random start so the 9 pures don't march in lockstep
}

function buildPure(seed: number): PureRig {
  const rand = mulberry32(seed * 2654435761 + 12345)
  // Deterministic sickly skin tone in the requested range.
  const tones = [0xcaa08a, 0xb98a70, 0xd4b09a, 0xc39a80, 0xbf9075]
  const skin = new THREE.Color(tones[Math.floor(rand() * tones.length)])
  const skinMat = mat(skin)

  const root = new THREE.Group()
  const body = new THREE.Group()
  root.add(body)

  // Torso: potbelly — a squashed box, wider at the belly. Unit height 1 so we
  // scale it live against `height` in the updater; here we bake proportions.
  const torso = new THREE.Mesh(BOX, skinMat)
  body.add(torso)

  // Head group (so we can tilt it when eating). Oversized ~1/4 of height.
  const head = new THREE.Group()
  const skull = new THREE.Mesh(SPHERE, skinMat)
  head.add(skull)
  // Creepy grinning face: two dark eye dots + a wide mouth slit, on the +Z face.
  const faceMat = mat(0x1a1210, { roughness: 1 })
  const eyeL = new THREE.Mesh(BOX, faceMat)
  const eyeR = new THREE.Mesh(BOX, faceMat)
  const mouth = new THREE.Mesh(BOX, faceMat)
  head.add(eyeL, eyeR, mouth)
  body.add(head)

  // Limbs (unit lengths; scaled in updater). Arms hang from shoulders, legs
  // from hips. materials shared with skin.
  const armL = makeLimb(skinMat, 1, 1, 1)
  const armR = makeLimb(skinMat, 1, 1, 1)
  const legL = makeLimb(skinMat, 1, 1, 1)
  const legR = makeLimb(skinMat, 1, 1, 1)
  body.add(armL.pivot, armR.pivot, legL.pivot, legR.pivot)

  // Consume flash: an additive red plane that pulses near the mouth.
  const flash = new THREE.Mesh(CIRCLE, new THREE.MeshBasicMaterial({
    color: 0xd8321e, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
  }))
  body.add(flash)

  // Blob shadow.
  const shadow = new THREE.Mesh(CIRCLE, new THREE.MeshBasicMaterial({
    color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false,
  }))
  shadow.rotation.x = -Math.PI / 2
  root.add(shadow)

  return {
    root, body, head, torso,
    arms: [armL, armR], legs: [legL, legR],
    flash, shadow,
    height: 8,
    phase: rand() * Math.PI * 2,
  }
}

// Apply static proportions for a given height (called when height changes).
function shapePure(rig: PureRig, h: number) {
  rig.height = h
  const headSize = h * 0.26
  const torsoH = h * 0.42
  const legLen = h * 0.4
  const armLen = h * 0.38
  const legTop = legLen // hips sit at leg length above ground
  const torsoW = h * 0.34
  const torsoD = h * 0.30

  rig.torso.scale.set(torsoW, torsoH, torsoD)
  rig.torso.position.y = legTop + torsoH / 2

  const head = rig.head
  head.position.y = legTop + torsoH + headSize * 0.32
  const skull = head.children[0] as THREE.Mesh
  skull.scale.setScalar(headSize)
  // face features on the front (+Z) of the skull
  const eR = headSize * 0.11
  const eyeL = head.children[1] as THREE.Mesh
  const eyeR = head.children[2] as THREE.Mesh
  const mouth = head.children[3] as THREE.Mesh
  eyeL.scale.set(eR, eR, eR * 0.4); eyeL.position.set(-headSize * 0.16, headSize * 0.06, headSize * 0.46)
  eyeR.scale.set(eR, eR, eR * 0.4); eyeR.position.set(headSize * 0.16, headSize * 0.06, headSize * 0.46)
  mouth.scale.set(headSize * 0.52, headSize * 0.12, eR * 0.4)
  mouth.position.set(0, -headSize * 0.22, headSize * 0.46)

  // shoulders at torso top, slightly inside torso width
  const shoulderY = legTop + torsoH * 0.92
  const shoulderX = torsoW * 0.55
  rig.arms[0].pivot.position.set(-shoulderX, shoulderY, 0)
  rig.arms[1].pivot.position.set(shoulderX, shoulderY, 0)
  for (const a of rig.arms) (a.mesh.scale.set(h * 0.11, armLen, h * 0.11))

  const hipX = torsoW * 0.28
  rig.legs[0].pivot.position.set(-hipX, legTop, 0)
  rig.legs[1].pivot.position.set(hipX, legTop, 0)
  for (const l of rig.legs) (l.mesh.scale.set(h * 0.14, legLen, h * 0.15))

  rig.flash.scale.setScalar(headSize * 0.9)
  rig.flash.position.set(0, head.position.y - headSize * 0.2, headSize * 0.6)

  rig.shadow.scale.setScalar(h * 0.22)
  rig.shadow.position.y = 0.15
}

function updatePure(rig: PureRig, st: TitanState, t: number) {
  const root = rig.root
  root.visible = st.visible
  if (!st.visible) return
  if (rig.height !== st.height) shapePure(rig, st.height)

  root.position.set(st.pos[0], st.pos[1], st.pos[2])
  root.rotation.y = st.yaw
  rig.shadow.position.set(0, 0.15, 0) // shadow stays flat at feet regardless of body

  const h = st.height
  const eat = st.eating

  if (eat > 0) {
    // Feeding: freeze the gait, raise both arms toward the mouth, tilt head down.
    // raise 0->0.4, hold 0.4->0.8, lower after.
    let raise: number
    if (eat < 0.4) raise = eat / 0.4
    else if (eat < 0.8) raise = 1
    else raise = Math.max(0, 1 - (eat - 0.8) / 0.2)
    const armAngle = THREE.MathUtils.lerp(0.15, -2.5, raise) // rotate arms up & in
    rig.arms[0].pivot.rotation.set(armAngle, 0, 0.25)
    rig.arms[1].pivot.rotation.set(armAngle, 0, -0.25)
    rig.legs[0].pivot.rotation.set(0, 0, 0)
    rig.legs[1].pivot.rotation.set(0, 0, 0)
    rig.head.rotation.x = 0.5 * raise
    rig.body.rotation.z = 0
    rig.body.position.y = 0

    // crimson consume puff while the victim is bitten.
    const fm = rig.flash.material as THREE.MeshBasicMaterial
    if (eat >= 0.55 && eat <= 0.85) {
      const p = (eat - 0.55) / 0.3
      fm.opacity = Math.sin(p * Math.PI) * (0.7 + 0.3 * Math.sin(t * 30))
      rig.flash.scale.setScalar(h * 0.26 * (0.7 + p * 0.6))
    } else {
      fm.opacity = 0
    }
    return
  }

  // reset flash when not eating
  ;(rig.flash.material as THREE.MeshBasicMaterial).opacity = 0

  if (st.walkSpeed > 0) {
    // Lumbering walk. Slow, heavy stride; speed inversely scaled by height so
    // giants move ponderously.
    const stride = (st.walkSpeed * 2.2) / h
    const ph = t * stride * Math.PI + rig.phase
    const s = Math.sin(ph)
    const swing = 0.5 + Math.min(0.4, st.walkSpeed * 0.02)
    rig.legs[0].pivot.rotation.x = s * swing
    rig.legs[1].pivot.rotation.x = -s * swing
    rig.arms[0].pivot.rotation.set(-s * swing * 0.6, 0, 0.18)
    rig.arms[1].pivot.rotation.set(s * swing * 0.6, 0, -0.18)
    // body bob (twice per stride) + lumbering roll
    rig.body.position.y = Math.abs(Math.cos(ph)) * h * 0.012
    rig.body.rotation.z = Math.sin(ph) * 0.05
    rig.head.rotation.x = 0.15 // slight forward hunch look
  } else {
    // idle: arms dangle, faint breathing sway
    const b = Math.sin(t * 1.2 + rig.phase)
    rig.legs[0].pivot.rotation.x = 0
    rig.legs[1].pivot.rotation.x = 0
    rig.arms[0].pivot.rotation.set(b * 0.04, 0, 0.14 + b * 0.02)
    rig.arms[1].pivot.rotation.set(-b * 0.04, 0, -0.14 - b * 0.02)
    rig.body.position.y = b * h * 0.004
    rig.body.rotation.z = 0
    rig.head.rotation.x = 0.05 + b * 0.03
  }
}

// ===========================================================================
// COLOSSAL TITAN (60m) — skinless exposed muscle, iconic wall kick.
// ===========================================================================
type ColossalRig = {
  root: THREE.Group
  body: THREE.Group
  torso: THREE.Mesh
  head: THREE.Mesh
  legKick: THREE.Group // right leg — driven by crouch
  legStand: THREE.Group
  arms: [Limb, Limb]
  bodyMats: THREE.MeshStandardMaterial[]
  steam: THREE.Points
  steamData: Float32Array // base positions + per-particle random (x,y,z, seedY, rnd)
  shadow: THREE.Mesh
  h: number
}

function buildColossal(): ColossalRig {
  const h = 60
  const root = new THREE.Group()
  const body = new THREE.Group()
  root.add(body)

  const muscle = mat(0x8f3b2e, { emissive: new THREE.Color(0x3a0e08), emissiveIntensity: 0.4, transparent: true })
  const shade = mat(0x6e2a22, { emissive: new THREE.Color(0x3a0e08), emissiveIntensity: 0.3, transparent: true })
  const bodyMats = [muscle, shade]

  const torsoH = h * 0.42
  const legLen = h * 0.46
  const legTop = legLen

  const torso = new THREE.Mesh(BOX, muscle)
  torso.scale.set(h * 0.22, torsoH, h * 0.14)
  torso.position.y = legTop + torsoH / 2
  body.add(torso)

  // broad shoulder girdle over a lean waist — the iconic V silhouette
  const shoulders = new THREE.Mesh(BOX, shade)
  shoulders.scale.set(h * 0.30, h * 0.07, h * 0.15)
  shoulders.position.y = legTop + torsoH * 0.93
  body.add(shoulders)

  // striation: a few darker inset ribcage bands across the chest
  for (let i = 0; i < 4; i++) {
    const band = new THREE.Mesh(BOX, shade)
    band.scale.set(h * 0.226, h * 0.016, h * 0.146)
    band.position.set(0, legTop + torsoH * (0.45 + i * 0.12), 0)
    body.add(band)
  }

  const head = new THREE.Mesh(BOX, muscle)
  head.scale.set(h * 0.11, h * 0.13, h * 0.12)
  head.position.y = legTop + torsoH + h * 0.10
  body.add(head)
  const neck = new THREE.Mesh(BOX, shade)
  neck.scale.set(h * 0.06, h * 0.07, h * 0.06)
  neck.position.y = legTop + torsoH + h * 0.025
  body.add(neck)

  // arms — long and lean, hang clear of the torso
  const armLen = h * 0.46
  const armL = makeLimb(muscle, h * 0.06, armLen, h * 0.06)
  const armR = makeLimb(muscle, h * 0.06, armLen, h * 0.06)
  armL.pivot.position.set(-h * 0.175, legTop + torsoH * 0.9, 0)
  armR.pivot.position.set(h * 0.175, legTop + torsoH * 0.9, 0)
  body.add(armL.pivot, armR.pivot)

  // legs — left plants, right kicks. Built as pivots at the hip.
  const legStand = new THREE.Group()
  const standMesh = new THREE.Mesh(BOX, muscle)
  standMesh.scale.set(h * 0.085, legLen, h * 0.10)
  standMesh.position.y = -legLen / 2
  legStand.add(standMesh)
  legStand.position.set(-h * 0.062, legTop, 0)
  body.add(legStand)

  const legKick = new THREE.Group()
  const kickMesh = new THREE.Mesh(BOX, muscle)
  kickMesh.scale.set(h * 0.085, legLen, h * 0.10)
  kickMesh.position.y = -legLen / 2
  legKick.add(kickMesh)
  legKick.position.set(h * 0.062, legTop, 0)
  body.add(legKick)

  // Steam: ~40 white billboard points drifting up around head/shoulders/back.
  const N = 44
  const positions = new Float32Array(N * 3)
  const data = new Float32Array(N * 5)
  const seed = mulberry32(9182736)
  for (let i = 0; i < N; i++) {
    const bx = (seed() - 0.5) * h * 0.5
    const by = legTop + torsoH * (0.5 + seed() * 0.6)
    const bz = (seed() - 0.5) * h * 0.36
    data[i * 5 + 0] = bx
    data[i * 5 + 1] = by
    data[i * 5 + 2] = bz
    data[i * 5 + 3] = seed() // vertical loop phase 0..1
    data[i * 5 + 4] = 0.4 + seed() * 0.6 // per-particle opacity/size mult
    positions[i * 3 + 0] = bx
    positions[i * 3 + 1] = by
    positions[i * 3 + 2] = bz
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const steamMat = new THREE.PointsMaterial({
    color: 0xffffff, size: h * 0.13, transparent: true, opacity: 0.25,
    depthWrite: false, sizeAttenuation: true,
  })
  const steam = new THREE.Points(geo, steamMat)
  root.add(steam)

  const shadow = new THREE.Mesh(CIRCLE, new THREE.MeshBasicMaterial({
    color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false,
  }))
  shadow.rotation.x = -Math.PI / 2
  shadow.scale.setScalar(h * 0.24)
  shadow.position.y = 0.15
  root.add(shadow)

  return { root, body, torso, head, legKick, legStand, arms: [armL, armR], bodyMats, steam, steamData: data, shadow, h }
}

function updateColossal(rig: ColossalRig, st: TitanState | null, steamAmt: number, t: number) {
  const root = rig.root
  if (!st || !st.visible) { root.visible = false; return }
  root.visible = true
  root.position.set(st.pos[0], st.pos[1], st.pos[2])
  root.rotation.y = st.yaw

  const c = st.crouch
  // The kick reads as one continuous motion as crouch 0->1: torso leans back,
  // the right leg sweeps from behind through a high forward arc.
  rig.body.rotation.x = -c * THREE.MathUtils.degToRad(20)
  const kickAngle = THREE.MathUtils.lerp(THREE.MathUtils.degToRad(-50), THREE.MathUtils.degToRad(70), c)
  rig.legKick.rotation.x = kickAngle
  rig.legStand.rotation.x = 0
  // arms counterbalance a touch during the kick
  rig.arms[0].pivot.rotation.set(c * 0.4, 0, 0.12)
  rig.arms[1].pivot.rotation.set(-c * 0.5, 0, -0.12)

  // very slow breathing bob when idle
  const breathe = 1 + Math.sin(t * 0.6) * 0.003 * (1 - c)
  rig.body.scale.y = breathe

  // Steam + dissolve.
  const amt = steamAmt
  const dissolve = Math.max(0, (amt - 0.6) / 0.4) // 0 until amt>0.6, ->1 at amt=1
  const pos = rig.steam.geometry.getAttribute('position') as THREE.BufferAttribute
  const data = rig.steamData
  const N = data.length / 5
  const rise = rig.h * 0.5
  for (let i = 0; i < N; i++) {
    const baseY = data[i * 5 + 1]
    const phase = data[i * 5 + 3]
    const loop = (phase + t * 0.12) % 1
    pos.setXYZ(i, data[i * 5 + 0], baseY + loop * rise, data[i * 5 + 2])
  }
  pos.needsUpdate = true
  const sm = rig.steam.material as THREE.PointsMaterial
  sm.opacity = Math.min(1, amt * 0.6 + dissolve * 0.4)
  sm.size = rig.h * 0.13 * (1 + dissolve * 1.2)

  // fade body away as it dissolves
  const bodyOpacity = 1 - dissolve
  for (const m of rig.bodyMats) m.opacity = bodyOpacity
  rig.body.visible = bodyOpacity > 0.02
}

// ===========================================================================
// ARMORED TITAN (15m) — bone-white plates over dark sinew, aggressive charge.
// ===========================================================================
type ArmoredRig = {
  root: THREE.Group
  body: THREE.Group
  arms: [Limb, Limb]
  legs: [Limb, Limb]
  head: THREE.Group
  shadow: THREE.Mesh
  h: number
}

function buildArmored(): ArmoredRig {
  const h = 15
  const root = new THREE.Group()
  const body = new THREE.Group()
  root.add(body)

  const sinew = mat(0x4a2f28)
  const plate = mat(0xe8d9c8, { roughness: 0.7 })

  const torsoH = h * 0.4
  const legLen = h * 0.44
  const legTop = legLen
  const torsoW = h * 0.36

  // dark sinew torso, then oversized plates layered on top
  const torso = new THREE.Mesh(BOX, sinew)
  torso.scale.set(torsoW, torsoH, h * 0.28)
  torso.position.y = legTop + torsoH / 2
  body.add(torso)

  const chestPlate = new THREE.Mesh(BOX, plate)
  chestPlate.scale.set(torsoW * 1.08, torsoH * 0.6, h * 0.30)
  chestPlate.position.set(0, legTop + torsoH * 0.65, h * 0.02)
  body.add(chestPlate)
  const abPlate = new THREE.Mesh(BOX, plate)
  abPlate.scale.set(torsoW * 0.9, torsoH * 0.35, h * 0.29)
  abPlate.position.set(0, legTop + torsoH * 0.28, h * 0.01)
  body.add(abPlate)
  const shoulderPlate = new THREE.Mesh(BOX, plate)
  shoulderPlate.scale.set(torsoW * 1.25, torsoH * 0.22, h * 0.32)
  shoulderPlate.position.set(0, legTop + torsoH * 0.95, 0)
  body.add(shoulderPlate)

  // plated head with dark eye slits
  const head = new THREE.Group()
  const skull = new THREE.Mesh(BOX, plate)
  skull.scale.set(h * 0.15, h * 0.15, h * 0.16)
  head.add(skull)
  const slitMat = mat(0x0a0605, { roughness: 1 })
  const slitL = new THREE.Mesh(BOX, slitMat)
  const slitR = new THREE.Mesh(BOX, slitMat)
  slitL.scale.set(h * 0.05, h * 0.02, h * 0.02); slitL.position.set(-h * 0.04, 0, h * 0.08)
  slitR.scale.set(h * 0.05, h * 0.02, h * 0.02); slitR.position.set(h * 0.04, 0, h * 0.08)
  head.add(slitL, slitR)
  head.position.y = legTop + torsoH + h * 0.08
  body.add(head)

  // arms (plated upper) — reuse plate material for armored look
  const armLen = h * 0.4
  const armL = makeLimb(plate, h * 0.11, armLen, h * 0.11)
  const armR = makeLimb(plate, h * 0.11, armLen, h * 0.11)
  armL.pivot.position.set(-torsoW * 0.62, legTop + torsoH * 0.9, 0)
  armR.pivot.position.set(torsoW * 0.62, legTop + torsoH * 0.9, 0)
  body.add(armL.pivot, armR.pivot)

  const legLenM = legLen
  const legL = makeLimb(plate, h * 0.14, legLenM, h * 0.15)
  const legR = makeLimb(plate, h * 0.14, legLenM, h * 0.15)
  legL.pivot.position.set(-torsoW * 0.28, legTop, 0)
  legR.pivot.position.set(torsoW * 0.28, legTop, 0)
  body.add(legL.pivot, legR.pivot)

  const shadow = new THREE.Mesh(CIRCLE, new THREE.MeshBasicMaterial({
    color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false,
  }))
  shadow.rotation.x = -Math.PI / 2
  shadow.scale.setScalar(h * 0.24)
  shadow.position.y = 0.15
  root.add(shadow)

  return { root, body, arms: [armL, armR], legs: [legL, legR], head, shadow, h }
}

function updateArmored(rig: ArmoredRig, st: TitanState | null, t: number) {
  const root = rig.root
  if (!st || !st.visible) { root.visible = false; return }
  root.visible = true
  root.position.set(st.pos[0], st.pos[1], st.pos[2])
  root.rotation.y = st.yaw

  // charge lean from crouch (~0.35 while charging)
  rig.body.rotation.x = st.crouch * THREE.MathUtils.degToRad(70) // 0.35 -> ~24.5deg
  rig.head.rotation.x = st.crouch * 0.4 // head down

  if (st.walkSpeed > 0) {
    // aggressive sprint gait — fast, long stride, arms pumping hard.
    const stride = (st.walkSpeed * 2.2) / rig.h
    const ph = t * stride * Math.PI
    const s = Math.sin(ph)
    const swing = st.running ? 1.15 : 0.85
    rig.legs[0].pivot.rotation.x = s * swing
    rig.legs[1].pivot.rotation.x = -s * swing
    rig.arms[0].pivot.rotation.set(-s * 1.1, 0, 0.16)
    rig.arms[1].pivot.rotation.set(s * 1.1, 0, -0.16)
    rig.body.position.y = Math.abs(Math.cos(ph)) * rig.h * 0.02
  } else {
    rig.legs[0].pivot.rotation.x = 0
    rig.legs[1].pivot.rotation.x = 0
    rig.arms[0].pivot.rotation.set(0, 0, 0.12)
    rig.arms[1].pivot.rotation.set(0, 0, -0.12)
    rig.body.position.y = 0
  }
}

// ===========================================================================
// COMPONENT
// ===========================================================================
export function Titans() {
  // Build every rig exactly once, then animate purely through refs in useFrame.
  const pures = useMemo(() => Array.from({ length: 9 }, (_, i) => buildPure(i + 1)), [])
  const colossal = useMemo(() => buildColossal(), [])
  const armored = useMemo(() => buildArmored(), [])

  const groupRef = useRef<THREE.Group>(null)

  useFrame(() => {
    const frame = getFrame()
    const t = performance.now() / 1000

    // pures — array is a stable, in-place-mutated singleton; copy per-index.
    const arr = frame.pures
    for (let i = 0; i < pures.length; i++) {
      const st = arr[i]
      if (st) updatePure(pures[i], st, t)
      else pures[i].root.visible = false
    }

    updateColossal(colossal, frame.colossal, frame.colossalSteam, t)
    updateArmored(armored, frame.armored, t)
  })

  return (
    <group ref={groupRef}>
      {pures.map((r, i) => (
        <primitive key={`pure-${i}`} object={r.root} />
      ))}
      <primitive object={colossal.root} />
      <primitive object={armored.root} />
    </group>
  )
}
