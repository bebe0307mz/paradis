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

// soft radial sprite so steam points render as puffs, not hard squares
const PUFF_TEX = (() => {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.55, 'rgba(255,255,255,0.5)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  return new THREE.CanvasTexture(c)
})()

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
// proportions derive from `height` so the same rig covers 4–15m titans. Every
// pure is seeded per-index at build so skin tone, head/arm disproportion and
// the shape of its permanent grin are deterministic yet individual — no two
// read alike, and none of it changes at render time.
type PureRig = {
  root: THREE.Group
  fall: THREE.Group // hinge at the feet — rotates the whole body over as it dies
  body: THREE.Group // everything above the feet — receives the bob/roll
  head: THREE.Group
  jaw: THREE.Group // lower face — opens/snaps during the eating cycle
  torso: THREE.Mesh
  arms: [Limb, Limb]
  legs: [Limb, Limb]
  flash: THREE.Mesh // crimson consume puff at the mouth
  handStain: THREE.Mesh // crimson stain flash on the raised hand
  shadow: THREE.Mesh
  skinMat: THREE.MeshStandardMaterial
  bodyMats: THREE.MeshStandardMaterial[] // faded out during the death dissolve
  steam: THREE.Points // rising death steam
  steamData: Float32Array // base positions + per-particle random
  fallDir: number // ±1 — topples toward or away from facing (seeded)
  height: number
  phase: number // random start so the pures don't march in lockstep
  // seeded disproportion + face character (baked once)
  headMul: number // head-size multiplier 1.1–1.5
  armMul: number // arm-length multiplier (sometimes past the knees)
  bodyGaunt: number // 1 = normal build, <1 = gaunter (smiling titan)
  grinWidth: number // fraction of face the mouth spans
  smiling: boolean // pure-0 = Dina Fritz, the Smiling Titan
}

// Sickly palette: pallid grey-pink, jaundiced yellow, flushed sunburnt.
const PURE_TONES = [
  0xb9a7a2, // pallid grey-pink
  0xa89a94, // ashen grey
  0xc9b98a, // jaundiced yellow
  0xbdae72, // sallow olive-yellow
  0xc98a72, // flushed sunburnt
  0xb87860, // raw sunburnt
  0xc2a893, // waxy
]

function buildPure(index: number): PureRig {
  const rand = mulberry32((index + 1) * 2654435761 + 12345)
  const smiling = index === 0

  // Deterministic sickly skin tone. The smiling titan is gaunter and paler.
  const skin = new THREE.Color(PURE_TONES[Math.floor(rand() * PURE_TONES.length)])
  if (smiling) skin.lerp(new THREE.Color(0xc7b3ab), 0.5)
  const skinMat = mat(skin)

  // face materials — shared, static colours (no vertexColors: geometry has none).
  // Every body material is made transparent so the death dissolve can fade the
  // whole titan out as its steam rises. skinMat is already transparent-capable
  // via the shared mat() default of transparent:false → flip it on here.
  skinMat.transparent = true
  const socketMat = mat(0x120a08, { roughness: 1, transparent: true }) // sunken dark sockets
  const pupilMat = new THREE.MeshBasicMaterial({ color: 0xfff2d8, transparent: true }) // tiny bright pupils
  const browMat = mat(new THREE.Color(skin).multiplyScalar(0.72), { roughness: 1, transparent: true })
  const mawMat = mat(0x0a0503, { roughness: 1, transparent: true }) // dark mouth slab
  const toothMat = mat(0xdcd2bf, { roughness: 0.6, transparent: true }) // blocky teeth
  const hairMat = mat(0x2e2416, { roughness: 1, transparent: true }) // dark-blonde hair slab (smiling titan)
  const bodyMats = [skinMat, socketMat, browMat, mawMat, toothMat, hairMat]

  const root = new THREE.Group()
  const fall = new THREE.Group() // toppling hinge — sits at the feet
  root.add(fall)
  const body = new THREE.Group()
  fall.add(body)

  // Torso: potbelly — a squashed box, wider at the belly.
  const torso = new THREE.Mesh(BOX, skinMat)
  body.add(torso)

  // Head group (tilts when eating). Children laid out in shapePure by index.
  const head = new THREE.Group()
  const skull = new THREE.Mesh(SPHERE, skinMat) // [0]
  head.add(skull)
  const browRidge = new THREE.Mesh(BOX, browMat) // [1] heavy brow
  const socketL = new THREE.Mesh(BOX, socketMat) // [2]
  const socketR = new THREE.Mesh(BOX, socketMat) // [3]
  const pupilL = new THREE.Mesh(BOX, pupilMat) // [4]
  const pupilR = new THREE.Mesh(BOX, pupilMat) // [5]
  const upperTeeth = new THREE.Mesh(BOX, mawMat) // [6] dark upper gum slab (teeth children of it)
  head.add(browRidge, socketL, socketR, pupilL, pupilR, upperTeeth)

  // Upper tooth row — small blocky white teeth across the grin. A handful of
  // boxes parented to the upper gum slab so they ride with the face.
  const TEETH = 7
  for (let i = 0; i < TEETH; i++) {
    upperTeeth.add(new THREE.Mesh(BOX, toothMat))
  }

  // Jaw group: the lower mouth slab + lower teeth, hinged so it drops open and
  // snaps shut during the bite.
  const jaw = new THREE.Group()
  const lowerGum = new THREE.Mesh(BOX, mawMat)
  jaw.add(lowerGum)
  for (let i = 0; i < TEETH; i++) {
    lowerGum.add(new THREE.Mesh(BOX, toothMat))
  }
  head.add(jaw)

  // Long dark-blonde hair slab down the back — only the smiling titan.
  if (smiling) {
    const hair = new THREE.Mesh(BOX, hairMat)
    hair.name = 'hair'
    head.add(hair)
  }

  body.add(head)

  // Limbs. Arms hang from shoulders, legs from hips. materials shared with skin.
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

  // Crimson stain flash on the raised hand during the bite.
  const handStain = new THREE.Mesh(CIRCLE, new THREE.MeshBasicMaterial({
    color: 0x9e0f0a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
  }))
  armR.pivot.add(handStain)

  // Blob shadow.
  const shadow = new THREE.Mesh(CIRCLE, new THREE.MeshBasicMaterial({
    color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false,
  }))
  shadow.rotation.x = -Math.PI / 2
  root.add(shadow)

  // Death steam: a modest cloud of billboard puffs rising off the corpse as it
  // dissolves. Positions get re-shaped for the actual height in shapePure; here
  // we just allocate the buffers deterministically. Invisible until steam>0.
  const SN = 28
  const steamPositions = new Float32Array(SN * 3)
  const steamData = new Float32Array(SN * 4) // x,y,z base + loop-phase
  const sseed = mulberry32((index + 1) * 40503 + 7)
  for (let i = 0; i < SN; i++) {
    steamData[i * 4 + 0] = sseed()
    steamData[i * 4 + 1] = sseed()
    steamData[i * 4 + 2] = sseed()
    steamData[i * 4 + 3] = sseed() // vertical loop phase 0..1
  }
  const steamGeo = new THREE.BufferGeometry()
  steamGeo.setAttribute('position', new THREE.BufferAttribute(steamPositions, 3))
  const steam = new THREE.Points(steamGeo, new THREE.PointsMaterial({
    color: 0xf2ece2, size: 1, transparent: true, opacity: 0,
    depthWrite: false, sizeAttenuation: true, map: PUFF_TEX,
  }))
  steam.visible = false
  root.add(steam)

  // Seeded disproportion. Smiling titan is extra-gaunt with a hungrier reach.
  const headMul = 1.1 + rand() * 0.4 // 1.1–1.5
  const armMul = 0.95 + rand() * 0.45 // up to ~1.4 — hangs past the knees
  const bodyGaunt = smiling ? 0.82 : 0.94 + rand() * 0.12
  const grinWidth = smiling ? 0.94 : 0.68 + rand() * 0.18

  return {
    root, fall, body, head, jaw, torso,
    arms: [armL, armR], legs: [legL, legR],
    flash, handStain, shadow, skinMat,
    bodyMats, steam, steamData,
    fallDir: rand() < 0.5 ? -1 : 1,
    height: 8,
    phase: rand() * Math.PI * 2,
    headMul, armMul, bodyGaunt, grinWidth, smiling,
  }
}

// Apply static proportions for a given height (called when height changes).
// Also lays out the whole face — grin, teeth, sockets, brow, jaw — from the
// per-titan seeded character baked in buildPure.
function shapePure(rig: PureRig, h: number) {
  rig.height = h
  const headSize = h * 0.24 * rig.headMul
  const torsoH = h * 0.42
  const legLen = h * 0.4
  const armLen = h * 0.38 * rig.armMul
  const legTop = legLen // hips sit at leg length above ground
  const torsoW = h * 0.34 * rig.bodyGaunt
  const torsoD = h * 0.30 * rig.bodyGaunt

  rig.torso.scale.set(torsoW, torsoH, torsoD)
  rig.torso.position.y = legTop + torsoH / 2

  const head = rig.head
  head.position.y = legTop + torsoH + headSize * 0.30
  const skull = head.children[0] as THREE.Mesh
  skull.scale.setScalar(headSize)

  // face features on the front (+Z) of the skull
  const faceZ = headSize * 0.44
  const brow = head.children[1] as THREE.Mesh
  const socketL = head.children[2] as THREE.Mesh
  const socketR = head.children[3] as THREE.Mesh
  const pupilL = head.children[4] as THREE.Mesh
  const pupilR = head.children[5] as THREE.Mesh
  const upperGum = head.children[6] as THREE.Mesh

  // Heavy brow ridge overhanging the eyes.
  brow.scale.set(headSize * 0.62, headSize * 0.10, headSize * 0.14)
  brow.position.set(0, headSize * 0.20, faceZ * 0.92)

  // Sunken dark eye sockets with a tiny bright pupil recessed inside each.
  const socketW = headSize * 0.20
  const eyeX = headSize * 0.17
  const eyeY = headSize * 0.08
  socketL.scale.set(socketW, socketW * 0.85, headSize * 0.14)
  socketR.scale.set(socketW, socketW * 0.85, headSize * 0.14)
  socketL.position.set(-eyeX, eyeY, faceZ * 0.86)
  socketR.position.set(eyeX, eyeY, faceZ * 0.86)
  const pupil = headSize * 0.05
  pupilL.scale.setScalar(pupil)
  pupilR.scale.setScalar(pupil)
  pupilL.position.set(-eyeX, eyeY, faceZ * 0.90)
  pupilR.position.set(eyeX, eyeY, faceZ * 0.90)

  // The grin. A wide dark upper gum slab spanning most of the face, dropped
  // low, with a row of small blocky teeth hanging below it. The jaw mirrors it.
  const grinW = headSize * rig.grinWidth
  const gumH = headSize * (rig.smiling ? 0.16 : 0.12)
  const mouthY = -headSize * 0.20
  upperGum.scale.set(grinW, gumH, headSize * 0.10)
  upperGum.position.set(0, mouthY, faceZ * 0.88)

  const toothW = grinW / 8
  const toothH = headSize * 0.10
  const toothD = headSize * 0.06
  // Teeth are children of the gum, so they inherit its local scale — divide the
  // intended world size back out so every tooth is an even little block.
  const layTeeth = (gum: THREE.Mesh, dir: number) => {
    const teeth = gum.children as unknown as THREE.Mesh[]
    for (let i = 0; i < teeth.length; i++) {
      const th = teeth[i]
      th.scale.set((toothW * 0.72) / gum.scale.x, toothH / gum.scale.y, toothD / gum.scale.z)
      const tx = (i - (teeth.length - 1) / 2) * (grinW / teeth.length)
      // dir: upper teeth (-1) hang below the gum, lower teeth (+1) rise above it
      th.position.set(tx / gum.scale.x, (dir * (gumH * 0.5 + toothH * 0.4)) / gum.scale.y, (headSize * 0.02) / gum.scale.z)
    }
  }
  layTeeth(upperGum, -1) // upper teeth point down

  // Jaw (lower mouth) hinged just below the upper gum.
  const jaw = rig.jaw
  jaw.position.set(0, mouthY, faceZ * 0.30)
  const lowerGum = jaw.children[0] as THREE.Mesh
  lowerGum.scale.set(grinW, gumH, headSize * 0.10)
  lowerGum.position.set(0, -gumH * 0.5, faceZ * 0.58)
  layTeeth(lowerGum, 1) // lower teeth point up

  // Long hair slab down the back (smiling titan only).
  const hair = head.getObjectByName('hair') as THREE.Mesh | undefined
  if (hair) {
    hair.scale.set(headSize * 0.7, headSize * 1.7, headSize * 0.35)
    hair.position.set(0, -headSize * 0.55, -faceZ * 0.7)
  }

  // shoulders at torso top, slightly inside torso width
  const shoulderY = legTop + torsoH * 0.92
  const shoulderX = torsoW * 0.55
  rig.arms[0].pivot.position.set(-shoulderX, shoulderY, 0)
  rig.arms[1].pivot.position.set(shoulderX, shoulderY, 0)
  for (const a of rig.arms) (a.mesh.scale.set(h * 0.10, armLen, h * 0.10))

  const hipX = torsoW * 0.28
  rig.legs[0].pivot.position.set(-hipX, legTop, 0)
  rig.legs[1].pivot.position.set(hipX, legTop, 0)
  for (const l of rig.legs) (l.mesh.scale.set(h * 0.14, legLen, h * 0.15))

  rig.flash.scale.setScalar(headSize * 0.9)
  rig.flash.position.set(0, head.position.y - headSize * 0.2, headSize * 0.6)

  // hand stain sits at the end of the right arm
  rig.handStain.scale.setScalar(h * 0.06)
  rig.handStain.position.set(0, -armLen, h * 0.06)

  rig.shadow.scale.setScalar(h * 0.22)
  rig.shadow.position.y = 0.15

  // Shape the death-steam cloud to the body: puffs seeded across a low, wide
  // volume (the corpse lies flat), sized to the titan. Base Y stays near the
  // ground since a downed titan is horizontal.
  const data = rig.steamData
  const SN = data.length / 4
  const pos = rig.steam.geometry.getAttribute('position') as THREE.BufferAttribute
  for (let i = 0; i < SN; i++) {
    const bx = (data[i * 4 + 0] - 0.5) * h * 0.6
    const by = data[i * 4 + 1] * h * 0.28
    const bz = (data[i * 4 + 2] - 0.5) * h * 0.9
    pos.setXYZ(i, bx, by, bz)
  }
  pos.needsUpdate = true
  const sm = rig.steam.material as THREE.PointsMaterial
  sm.size = h * 0.22
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
  const fm = rig.flash.material as THREE.MeshBasicMaterial
  const hsm = rig.handStain.material as THREE.MeshBasicMaterial

  // -------------------------------------------------------------------------
  // DEATH — nape-cut or punched down. `down` topples the rig around its feet
  // (ease-out) until it lies flat with a slight ground sink; `steam` then
  // dissolves the body while puffs rise. A dead titan does not walk or eat.
  // -------------------------------------------------------------------------
  if (st.down > 0 || st.steam > 0) {
    fm.opacity = 0
    hsm.opacity = 0
    rig.jaw.rotation.x = 0
    rig.head.rotation.z = 0

    // freeze the limbs into a slack collapse and kill any residual bob/roll
    rig.body.position.y = 0
    rig.body.rotation.z = 0
    rig.head.rotation.x = 0.1
    rig.arms[0].pivot.rotation.set(0.2, 0, 0.22)
    rig.arms[1].pivot.rotation.set(0.2, 0, -0.22)
    rig.legs[0].pivot.rotation.x = 0
    rig.legs[1].pivot.rotation.x = 0

    // topple: ease-out rotation about the feet toward fallDir, ending flat.
    const d = st.down
    const eased = 1 - (1 - d) * (1 - d)
    rig.fall.rotation.x = rig.fallDir * eased * (Math.PI / 2)
    rig.fall.position.y = -eased * h * 0.04 // slight sink into the ground

    // dissolve the body materials as steam rises; hide once fully gone.
    const dissolve = st.steam
    const bodyOpacity = 1 - dissolve
    for (const m of rig.bodyMats) m.opacity = bodyOpacity
    ;(rig.flash.material as THREE.MeshBasicMaterial).opacity = 0
    rig.body.visible = bodyOpacity > 0.02
    rig.shadow.visible = bodyOpacity > 0.02

    // steam puffs rise and fade over the corpse.
    if (dissolve > 0) {
      rig.steam.visible = true
      const sd = rig.steamData
      const SN = sd.length / 4
      const spos = rig.steam.geometry.getAttribute('position') as THREE.BufferAttribute
      const rise = h * 0.7
      for (let i = 0; i < SN; i++) {
        const bx = (sd[i * 4 + 0] - 0.5) * h * 0.6
        const by = sd[i * 4 + 1] * h * 0.28
        const bz = (sd[i * 4 + 2] - 0.5) * h * 0.9
        const loop = (sd[i * 4 + 3] + dissolve * 1.2) % 1
        spos.setXYZ(i, bx, by + loop * rise, bz)
      }
      spos.needsUpdate = true
      const sm = rig.steam.material as THREE.PointsMaterial
      sm.opacity = Math.sin(Math.min(1, dissolve) * Math.PI) * 0.7
    } else {
      rig.steam.visible = false
    }
    return
  }

  // alive: ensure the toppling hinge and dissolve are reset
  if (rig.fall.rotation.x !== 0) {
    rig.fall.rotation.x = 0
    rig.fall.position.y = 0
    for (const m of rig.bodyMats) m.opacity = 1
    rig.body.visible = true
    rig.shadow.visible = true
    rig.steam.visible = false
  }

  if (eat > 0) {
    // Feeding, staged as a brutal read:
    //   0.00–0.40  the raised hand lifts the victim up toward the tilted-back head
    //   0.40–0.55  head fully back, jaw yawns wide open over the dangling victim
    //   0.55–0.70  the jaw SNAPS shut — a hard, fast slam
    //   0.55–0.90  crimson bursts on mouth and hand
    //   0.70–1.00  head rocks in a couple of sharp post-bite shakes
    rig.legs[0].pivot.rotation.set(0, 0, 0)
    rig.legs[1].pivot.rotation.set(0, 0, 0)
    rig.body.rotation.z = 0
    rig.body.position.y = 0

    // Right arm raises the victim high and inward; left arm follows loosely.
    let raise: number
    if (eat < 0.4) raise = eat / 0.4
    else if (eat < 0.8) raise = 1
    else raise = Math.max(0, 1 - (eat - 0.8) / 0.2)
    const armAngle = THREE.MathUtils.lerp(0.15, -2.6, raise)
    rig.arms[1].pivot.rotation.set(armAngle, 0, -0.30)
    rig.arms[0].pivot.rotation.set(THREE.MathUtils.lerp(0.15, -1.8, raise), 0, 0.25)

    // Head tilts back to receive, then whips forward on the bite.
    let headX: number
    if (eat < 0.55) headX = -0.55 * (eat / 0.55) // tilt back
    else if (eat < 0.70) headX = -0.55 + 0.75 * ((eat - 0.55) / 0.15) // snap forward+down
    else {
      // post-bite: sharp diminishing shakes
      const p = (eat - 0.70) / 0.30
      headX = 0.20 + Math.sin(p * Math.PI * 3) * 0.22 * (1 - p)
    }
    rig.head.rotation.x = headX
    rig.head.rotation.z = eat >= 0.70 ? Math.sin((eat - 0.70) / 0.30 * Math.PI * 3) * 0.12 * (1 - (eat - 0.70) / 0.30) : 0

    // Jaw: yawns open toward the bite, then slams shut fast at 0.55–0.70.
    let jawOpen: number
    if (eat < 0.4) jawOpen = 0.15 + 0.85 * (eat / 0.4)
    else if (eat < 0.55) jawOpen = 1
    else if (eat < 0.70) jawOpen = 1 - (eat - 0.55) / 0.15 // SNAP shut
    else jawOpen = 0.05 + Math.max(0, Math.sin((eat - 0.70) / 0.30 * Math.PI * 3)) * 0.10 // small chews
    rig.jaw.rotation.x = jawOpen * 0.7

    // crimson consume puff at the mouth + stain on the hand during the bite.
    if (eat >= 0.55 && eat <= 0.90) {
      const p = (eat - 0.55) / 0.35
      const flick = 0.7 + 0.3 * Math.sin(t * 30)
      fm.opacity = Math.sin(p * Math.PI) * flick
      rig.flash.scale.setScalar(h * 0.26 * (0.7 + p * 0.6))
      hsm.opacity = Math.sin(p * Math.PI) * 0.85
    } else {
      fm.opacity = 0
      hsm.opacity = 0
    }
    return
  }

  // reset consume flash + jaw when not eating
  fm.opacity = 0
  hsm.opacity = 0
  rig.jaw.rotation.x = 0
  rig.head.rotation.z = 0

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

  // Deeper skinless look: darker raw sinew reds with a faint ember-orange glow
  // bleeding out of the seams.
  const muscle = mat(0x6f2a1e, { emissive: new THREE.Color(0x4a1305), emissiveIntensity: 0.55, transparent: true })
  const shade = mat(0x511c16, { emissive: new THREE.Color(0x3a0e05), emissiveIntensity: 0.4, transparent: true })
  const fiber = mat(0x3a1310, { emissive: new THREE.Color(0x2a0a04), emissiveIntensity: 0.35, transparent: true }) // dark muscle-fiber striation
  const ember = mat(0x7a2408, { emissive: new THREE.Color(0xc7440e), emissiveIntensity: 1.4, transparent: true }) // glowing body seams
  const bone = mat(0xd8cbb2, { roughness: 0.6, transparent: true }) // exposed jaw teeth
  const bodyMats = [muscle, shade, fiber, ember, bone]

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

  // Exposed lipless jaw — two rows of bone-white teeth clenched across the
  // lower head, no lips over them.
  const headY = legTop + torsoH + h * 0.10
  const upperTeeth = new THREE.Mesh(BOX, bone)
  upperTeeth.scale.set(h * 0.10, h * 0.018, h * 0.02)
  upperTeeth.position.set(0, headY - h * 0.03, h * 0.062)
  const lowerTeeth = new THREE.Mesh(BOX, bone)
  lowerTeeth.scale.set(h * 0.10, h * 0.018, h * 0.02)
  lowerTeeth.position.set(0, headY - h * 0.055, h * 0.062)
  body.add(upperTeeth, lowerTeeth)

  // Vertical muscle-fiber striation: thin darker boxes running down the torso
  // and the front of each limb. Purely additive detail on the existing rig.
  for (let i = 0; i < 5; i++) {
    const strip = new THREE.Mesh(BOX, fiber)
    strip.scale.set(h * 0.012, torsoH * 0.9, h * 0.005)
    strip.position.set((i - 2) * h * 0.045, legTop + torsoH * 0.5, h * 0.072)
    body.add(strip)
  }

  // Ember-glow seams: a few emissive slivers along the chest centreline and
  // shoulder joints, so heat looks like it's leaking through the sinew.
  const seamSpecs: Array<[number, number, number, number]> = [
    [0, legTop + torsoH * 0.7, h * 0.008, torsoH * 0.5],
    [-h * 0.14, legTop + torsoH * 0.9, h * 0.006, h * 0.10],
    [h * 0.14, legTop + torsoH * 0.9, h * 0.006, h * 0.10],
  ]
  for (const [sx, sy, sw, sh] of seamSpecs) {
    const seam = new THREE.Mesh(BOX, ember)
    seam.scale.set(sw, sh, h * 0.004)
    seam.position.set(sx, sy, h * 0.073)
    body.add(seam)
  }

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

  // Steam: dense white billboard points drifting up around head/shoulders/back.
  const N = 96
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
    color: 0xf2ece2, size: h * 0.18, transparent: true, opacity: 0.4,
    depthWrite: false, sizeAttenuation: true, map: PUFF_TEX,
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
  sm.opacity = Math.min(1, 0.28 + amt * 0.5 + dissolve * 0.4) // always smoldering
  sm.size = rig.h * 0.15 * (1 + dissolve * 1.2)

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

  const sinew = mat(0x2e1c17) // dark sinew showing between the plates
  const plate = mat(0xece0d0, { roughness: 0.7 })
  const edge = mat(0xfff6e8, { roughness: 0.4, emissive: new THREE.Color(0x2a2013), emissiveIntensity: 0.25 }) // bone-white plate edge highlight
  const eyeGlow = mat(0x8a7a20, { emissive: new THREE.Color(0xf2e35a), emissiveIntensity: 1.6 }) // glowing pale-yellow eyes

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

  // Bone-white edge highlights: thin bright rims proud of each plate's lower lip.
  const edgeTrim = (w: number, y: number, z: number) => {
    const e = new THREE.Mesh(BOX, edge)
    e.scale.set(w, h * 0.012, h * 0.02)
    e.position.set(0, y, z)
    body.add(e)
  }
  edgeTrim(torsoW * 1.08, legTop + torsoH * 0.65 - torsoH * 0.30, h * 0.17)
  edgeTrim(torsoW * 0.9, legTop + torsoH * 0.28 - torsoH * 0.175, h * 0.155)
  edgeTrim(torsoW * 1.25, legTop + torsoH * 0.95 - torsoH * 0.11, h * 0.16)

  // Dark sinew showing in the gap between chest and ab plates.
  const gap = new THREE.Mesh(BOX, sinew)
  gap.scale.set(torsoW * 0.85, torsoH * 0.10, h * 0.27)
  gap.position.set(0, legTop + torsoH * 0.46, h * 0.015)
  body.add(gap)

  // plated head with dark eye slits
  const head = new THREE.Group()
  const skull = new THREE.Mesh(BOX, plate)
  skull.scale.set(h * 0.15, h * 0.15, h * 0.16)
  head.add(skull)
  const slitL = new THREE.Mesh(BOX, eyeGlow)
  const slitR = new THREE.Mesh(BOX, eyeGlow)
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
// ROGUE TITAN (15m) — Eren's titan. Lean muscular skin-toned body with
// exposed-sinew accents, long shaggy dark hair, pointed ears, a lipless
// permanently-bared jagged grin, hard cheekbones, glowing green eyes. It
// sprints, roars, throws crossing punches, then carries the boulder overhead.
// ===========================================================================
type RogueRig = {
  root: THREE.Group
  body: THREE.Group
  torso: THREE.Group // upper-body pivot at the waist — roar lean / carry / punch twist
  head: THREE.Group
  jaw: THREE.Group
  arms: [Limb, Limb]
  legs: [Limb, Limb]
  steam: THREE.Points
  steamData: Float32Array
  shadow: THREE.Mesh
  h: number
}

function buildRogue(): RogueRig {
  const h = 15
  const root = new THREE.Group()
  const body = new THREE.Group()
  root.add(body)

  // Palette: warm skin over exposed dark-red sinew accents, bared bone teeth,
  // dark-brown hair, and hot-green glowing eyes.
  const skin = mat(0xb07a5e, { roughness: 0.8 }) // Eren-titan tan skin
  const sinew = mat(0x7a2b22, { roughness: 0.75, emissive: new THREE.Color(0x2a0a06), emissiveIntensity: 0.3 }) // exposed muscle at cheeks/forearms
  const bone = mat(0xe6dcc6, { roughness: 0.55 }) // bared teeth
  const maw = mat(0x1a0d09, { roughness: 1 }) // dark mouth line behind the teeth
  const hairMat = mat(0x2a2018, { roughness: 1 }) // shaggy dark-brown hair
  const eyeGlow = mat(0x2f7a1f, { emissive: new THREE.Color(0x5cff4a), emissiveIntensity: 1.9 }) // glowing green eyes

  const torsoH = h * 0.4
  const legLen = h * 0.46
  const legTop = legLen

  // Upper-body pivot at the waist so roar-lean, carry, and punch-twist all
  // rotate the torso+arms+head as one unit about the hips.
  const torso = new THREE.Group()
  torso.position.y = legTop
  body.add(torso)

  // Lean muscular trunk — a touch narrower than the pures, athletic V.
  const trunk = new THREE.Mesh(BOX, skin)
  trunk.scale.set(h * 0.26, torsoH, h * 0.17)
  trunk.position.y = torsoH / 2
  torso.add(trunk)
  // broad shoulder girdle
  const shoulders = new THREE.Mesh(BOX, skin)
  shoulders.scale.set(h * 0.34, h * 0.08, h * 0.18)
  shoulders.position.y = torsoH * 0.92
  torso.add(shoulders)
  // a couple of exposed-sinew rib accents down the flank
  for (let i = 0; i < 3; i++) {
    const band = new THREE.Mesh(BOX, sinew)
    band.scale.set(h * 0.255, h * 0.02, h * 0.172)
    band.position.set(0, torsoH * (0.4 + i * 0.16), 0)
    torso.add(band)
  }
  // abdominal sinew line down the centre
  const abLine = new THREE.Mesh(BOX, sinew)
  abLine.scale.set(h * 0.03, torsoH * 0.7, h * 0.01)
  abLine.position.set(0, torsoH * 0.5, h * 0.086)
  torso.add(abLine)

  // ---- Head: lean, hard-cheekboned, lipless bared grin ----
  const head = new THREE.Group()
  const skull = new THREE.Mesh(BOX, skin)
  skull.scale.set(h * 0.13, h * 0.15, h * 0.14)
  head.add(skull)

  // hard cheekbone ridges — angled sinew accents under the eyes
  const cheekL = new THREE.Mesh(BOX, sinew)
  const cheekR = new THREE.Mesh(BOX, sinew)
  cheekL.scale.set(h * 0.05, h * 0.03, h * 0.03)
  cheekR.scale.copy(cheekL.scale)
  cheekL.position.set(-h * 0.045, -h * 0.01, h * 0.066)
  cheekR.position.set(h * 0.045, -h * 0.01, h * 0.066)
  cheekL.rotation.z = 0.3
  cheekR.rotation.z = -0.3
  head.add(cheekL, cheekR)

  // glowing green eyes — small bright blocks set under a brow
  const brow = new THREE.Mesh(BOX, skin)
  brow.scale.set(h * 0.12, h * 0.02, h * 0.03)
  brow.position.set(0, h * 0.035, h * 0.066)
  head.add(brow)
  const eyeL = new THREE.Mesh(BOX, eyeGlow)
  const eyeR = new THREE.Mesh(BOX, eyeGlow)
  eyeL.scale.set(h * 0.035, h * 0.02, h * 0.02)
  eyeR.scale.copy(eyeL.scale)
  eyeL.position.set(-h * 0.032, h * 0.012, h * 0.07)
  eyeR.position.set(h * 0.032, h * 0.012, h * 0.07)
  head.add(eyeL, eyeR)

  // pointed elf-like ears
  const earL = new THREE.Mesh(BOX, skin)
  const earR = new THREE.Mesh(BOX, skin)
  earL.scale.set(h * 0.015, h * 0.05, h * 0.02)
  earR.scale.copy(earL.scale)
  earL.position.set(-h * 0.068, h * 0.01, 0)
  earR.position.set(h * 0.068, h * 0.01, 0)
  earL.rotation.z = 0.5
  earR.rotation.z = -0.5
  head.add(earL, earR)

  // Lipless bared grin: a dark maw slab with a permanent jagged white upper
  // tooth row across it, no lips. The jaw carries the matching lower row.
  const mawSlab = new THREE.Mesh(BOX, maw)
  mawSlab.scale.set(h * 0.11, h * 0.05, h * 0.03)
  mawSlab.position.set(0, -h * 0.045, h * 0.062)
  head.add(mawSlab)
  const upperTeeth = new THREE.Mesh(BOX, bone)
  upperTeeth.scale.set(h * 0.10, h * 0.02, h * 0.018)
  upperTeeth.position.set(0, -h * 0.035, h * 0.07)
  head.add(upperTeeth)
  // jagged look: a few tooth points hanging below the upper row
  for (let i = 0; i < 6; i++) {
    const tooth = new THREE.Mesh(BOX, bone)
    tooth.scale.set(h * 0.012, h * 0.02, h * 0.016)
    tooth.position.set((i - 2.5) * h * 0.018, -h * 0.05, h * 0.071)
    head.add(tooth)
  }

  // hinged jaw with the lower jagged tooth row
  const jaw = new THREE.Group()
  jaw.position.set(0, -h * 0.05, h * 0.03)
  const lowerTeeth = new THREE.Mesh(BOX, bone)
  lowerTeeth.scale.set(h * 0.10, h * 0.02, h * 0.018)
  lowerTeeth.position.set(0, -h * 0.01, h * 0.035)
  jaw.add(lowerTeeth)
  for (let i = 0; i < 6; i++) {
    const tooth = new THREE.Mesh(BOX, bone)
    tooth.scale.set(h * 0.012, h * 0.02, h * 0.016)
    tooth.position.set((i - 2.5) * h * 0.018, h * 0.005, h * 0.036)
    jaw.add(tooth)
  }
  head.add(jaw)

  // Long shaggy dark-brown hair slab reaching the shoulders. Rendered as a
  // couple of overlapping slabs so it reads as hanging locks, not a helmet.
  const hairBack = new THREE.Mesh(BOX, hairMat)
  hairBack.scale.set(h * 0.15, h * 0.16, h * 0.06)
  hairBack.position.set(0, h * 0.0, -h * 0.05)
  head.add(hairBack)
  const hairTop = new THREE.Mesh(BOX, hairMat)
  hairTop.scale.set(h * 0.15, h * 0.06, h * 0.15)
  hairTop.position.set(0, h * 0.06, -h * 0.005)
  head.add(hairTop)
  // side locks down to the shoulders
  const lockL = new THREE.Mesh(BOX, hairMat)
  const lockR = new THREE.Mesh(BOX, hairMat)
  lockL.scale.set(h * 0.03, h * 0.14, h * 0.05)
  lockR.scale.copy(lockL.scale)
  lockL.position.set(-h * 0.06, -h * 0.03, -h * 0.02)
  lockR.position.set(h * 0.06, -h * 0.03, -h * 0.02)
  head.add(lockL, lockR)

  head.position.set(0, torsoH + h * 0.09, 0)
  torso.add(head)

  // Arms — lean, with exposed-sinew forearms. Hang from the shoulder girdle.
  const armLen = h * 0.44
  const armL = makeLimb(skin, h * 0.08, armLen, h * 0.08)
  const armR = makeLimb(skin, h * 0.08, armLen, h * 0.08)
  // forearm sinew accent on each arm
  for (const a of [armL, armR]) {
    const fore = new THREE.Mesh(BOX, sinew)
    fore.scale.set(h * 0.085, armLen * 0.42, h * 0.085)
    fore.position.y = -armLen * 0.72
    a.pivot.add(fore)
  }
  armL.pivot.position.set(-h * 0.18, torsoH * 0.9, 0)
  armR.pivot.position.set(h * 0.18, torsoH * 0.9, 0)
  torso.add(armL.pivot, armR.pivot)

  // Legs — from the hips at the base of the body (not the torso pivot, so they
  // stay planted while the torso leans).
  const legL = makeLimb(skin, h * 0.12, legLen, h * 0.13)
  const legR = makeLimb(skin, h * 0.12, legLen, h * 0.13)
  legL.pivot.position.set(-h * 0.09, legTop, 0)
  legR.pivot.position.set(h * 0.09, legTop, 0)
  body.add(legL.pivot, legR.pivot)

  // Steam — like the colossal, scaled to 15m. Simmers faintly all battle.
  const N = 40
  const positions = new Float32Array(N * 3)
  const data = new Float32Array(N * 5)
  const seed = mulberry32(30717)
  for (let i = 0; i < N; i++) {
    const bx = (seed() - 0.5) * h * 0.5
    const by = legTop + torsoH * (0.4 + seed() * 0.7)
    const bz = (seed() - 0.5) * h * 0.34
    data[i * 5 + 0] = bx
    data[i * 5 + 1] = by
    data[i * 5 + 2] = bz
    data[i * 5 + 3] = seed()
    data[i * 5 + 4] = 0.4 + seed() * 0.6
    positions[i * 3 + 0] = bx
    positions[i * 3 + 1] = by
    positions[i * 3 + 2] = bz
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const steam = new THREE.Points(geo, new THREE.PointsMaterial({
    color: 0xf2ece2, size: h * 0.16, transparent: true, opacity: 0.12,
    depthWrite: false, sizeAttenuation: true, map: PUFF_TEX,
  }))
  root.add(steam)

  const shadow = new THREE.Mesh(CIRCLE, new THREE.MeshBasicMaterial({
    color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false,
  }))
  shadow.rotation.x = -Math.PI / 2
  shadow.scale.setScalar(h * 0.24)
  shadow.position.y = 0.15
  root.add(shadow)

  return { root, body, torso, head, jaw, arms: [armL, armR], legs: [legL, legR], steam, steamData: data, shadow, h }
}

function updateRogue(rig: RogueRig, st: TitanState | null, t: number) {
  const root = rig.root
  if (!st || !st.visible) { root.visible = false; return }
  root.visible = true
  // pos[1] can be NEGATIVE during birth (rising out of a carcass) — apply verbatim.
  root.position.set(st.pos[0], st.pos[1], st.pos[2])
  root.rotation.y = st.yaw
  rig.shadow.position.y = 0.15 - st.pos[1] // keep the shadow on the ground during birth
  const h = rig.h

  const crouch = st.crouch
  const attack = st.attack
  const carry = st.carry

  // ---- base torso posture ----
  // crouch bends the knees + leans the torso back into a roar / lift / kneel.
  // carry raises the whole torso slightly upright (holding weight overhead).
  let torsoLean = -crouch * 0.5 // lean back for roar/lift
  rig.torso.position.y = rig.legs[0].pivot.position.y - crouch * h * 0.06 // sink at the waist

  // knees bend with crouch
  rig.legs[0].pivot.rotation.x = crouch * 0.5
  rig.legs[1].pivot.rotation.x = crouch * 0.5

  // head thrown back during the roar (crouch drives it)
  rig.head.rotation.x = -crouch * 0.7 + 0.05
  rig.jaw.rotation.x = crouch * 0.5 // maw gapes for the roar

  // ---- carry: both arms overhead, heavy slow gait ----
  if (carry > 0) {
    // arms raise overhead holding the boulder (rendered elsewhere)
    const raise = carry
    rig.arms[0].pivot.rotation.set(-Math.PI * 0.92 * raise, 0, 0.15 * raise)
    rig.arms[1].pivot.rotation.set(-Math.PI * 0.92 * raise, 0, -0.15 * raise)
    torsoLean += carry * 0.12 // slight upright brace under the weight
    rig.jaw.rotation.x = Math.max(rig.jaw.rotation.x, carry * 0.15) // strain
  }

  // ---- punch: windup 0..0.45, cross 0.45..0.6, recover 0.6..1 ----
  if (attack > 0 && carry <= 0.02) {
    let ext: number // right-arm extension: -1 pulled back → +1 fully crossed
    let twist: number
    if (attack < 0.45) {
      const p = attack / 0.45
      ext = -0.6 * p // wind the fist back
      twist = -0.35 * p
    } else if (attack < 0.6) {
      const p = (attack - 0.45) / 0.15
      ext = -0.6 + 1.6 * p // explosive straight cross
      twist = -0.35 + 0.6 * p
    } else {
      const p = (attack - 0.6) / 0.4
      ext = 1.0 * (1 - p) // recover to neutral
      twist = 0.25 * (1 - p)
    }
    rig.torso.rotation.y = twist
    // right arm drives the cross; left arm guards
    rig.arms[1].pivot.rotation.set(-Math.PI * 0.5 + ext * 1.2, ext * 0.5, -0.15)
    rig.arms[0].pivot.rotation.set(-0.5, 0, 0.3)
  } else {
    rig.torso.rotation.y = 0
  }

  rig.torso.rotation.x = torsoLean

  // ---- run cycle (only when not punching/carrying overrides the arms) ----
  const heavy = carry > 0.02
  if (st.walkSpeed > 0) {
    const stride = (st.walkSpeed * 2.2) / h
    const ph = t * stride * Math.PI + 0.5
    const s = Math.sin(ph)
    // exaggerate arm swing when sprinting fast; damp when heavy-carry
    const legSwing = heavy ? 0.55 : 1.15
    const armSwing = heavy ? 0 : Math.min(1.5, 0.8 + st.walkSpeed * 0.04)
    rig.legs[0].pivot.rotation.x = crouch * 0.5 + s * legSwing
    rig.legs[1].pivot.rotation.x = crouch * 0.5 - s * legSwing
    if (!heavy && attack <= 0.02) {
      rig.arms[0].pivot.rotation.set(-s * armSwing, 0, 0.14)
      rig.arms[1].pivot.rotation.set(s * armSwing, 0, -0.14)
    }
    // body bounce — reduced heavily during the carry
    rig.body.position.y = Math.abs(Math.cos(ph)) * h * (heavy ? 0.006 : 0.025)
  } else {
    rig.body.position.y = 0
    if (attack <= 0.02 && carry <= 0.02 && crouch < 0.02) {
      // idle breathing / menace
      const b = Math.sin(t * 1.4)
      rig.arms[0].pivot.rotation.set(b * 0.05, 0, 0.16)
      rig.arms[1].pivot.rotation.set(-b * 0.05, 0, -0.16)
    }
  }

  // ---- steam: simmers faintly, driven by st.steam ----
  const amt = Math.max(0.05, st.steam)
  const pos = rig.steam.geometry.getAttribute('position') as THREE.BufferAttribute
  const data = rig.steamData
  const N = data.length / 5
  const rise = h * 0.5
  for (let i = 0; i < N; i++) {
    const baseY = data[i * 5 + 1]
    const loop = (data[i * 5 + 3] + t * 0.12) % 1
    pos.setXYZ(i, data[i * 5 + 0], baseY + loop * rise, data[i * 5 + 2])
  }
  pos.needsUpdate = true
  const sm = rig.steam.material as THREE.PointsMaterial
  sm.opacity = Math.min(0.9, 0.1 + amt * 0.7)
}

// ===========================================================================
// COMPONENT
// ===========================================================================
export function Titans() {
  // Build every rig exactly once, then animate purely through refs in useFrame.
  // Pure count is taken from the incident frame (ids pure-0..pure-N) so nothing
  // is hardcoded to a fixed cast size — the driver currently emits 13.
  const pureCount = useMemo(() => Math.max(getFrame().pures.length, 1), [])
  const pures = useMemo(
    () => Array.from({ length: pureCount }, (_, i) => buildPure(i)),
    [pureCount],
  )
  const colossal = useMemo(() => buildColossal(), [])
  const armored = useMemo(() => buildArmored(), [])
  const rogue = useMemo(() => buildRogue(), [])

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
    updateRogue(rogue, frame.rogue, t)
  })

  return (
    <group ref={groupRef}>
      {pures.map((r, i) => (
        <primitive key={`pure-${i}`} object={r.root} />
      ))}
      <primitive object={colossal.root} />
      <primitive object={armored.root} />
      <primitive object={rogue.root} />
    </group>
  )
}
