// Procedural medieval towns inside every district + the royal capital Mitras.
//
// Buildings are CONSTRUCTED, not toy boxes: each archetype is a single merged
// BufferGeometry with a baked per-vertex `color` attribute — plaster walls,
// exposed dark timber framing (fachwerk), recessed doors, window insets (some
// warm-lit), gabled clay/slate roofs with eave overhang + ridge cap + chimney,
// and a base skirt sunk below y=0 so nothing floats.
//
// One InstancedMesh per archetype (meshStandardMaterial vertexColors:true — the
// merged geometry HAS a color attribute, so this is correct). Subtle per-instance
// tint via instanceColor (0.9–1.05) multiplies the baked vertex colors.
//
// Everything is STATIC: built once in useMemo, matrices + instanceColor baked,
// zero per-frame work. Placement is deterministic (seeded per district).

import { useMemo, useRef, useLayoutEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CylinderGeometry,
  Color,
  Euler,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import {
  DISTRICTS,
  DISTRICT_R,
  districtGateCenter,
  districtOutward,
  type DistrictDef,
} from '../world/constants'
import { mulberry32, range } from '../world/rng'
import { getFrame } from '../incidents/driver'
import { EP1_TITAN_TRACKS } from '../incidents/ep1'
import { EP2_TITAN_TRACKS } from '../incidents/ep2'
import type { TitanTrack } from '../incidents/ep1'

// ---------------------------------------------------------------------------
// palette — aged, desaturated, earthy. NOT pastel.
// ---------------------------------------------------------------------------
const PLASTER = ['#cabfa6', '#bfae90', '#c7b59a', '#b6a683', '#d0c6ae'] // dirty cream / ochre / grey-tan
const TIMBER = '#3a2c20' // dark exposed oak framing
const TIMBER_LIGHT = '#4a3826'
const ROOF_TILE = ['#8a4a34', '#7c4230', '#9a5942', '#6d3b2c'] // clay-tile red-browns
const ROOF_SLATE = ['#565f64', '#4a5257', '#616a70'] // slate greys
const RIDGE = '#2e2620'
const DOOR = '#241a12'
const WINDOW_DARK = '#1c1712'
const WINDOW_LIT = '#e8b25c' // warm interior glow (brighter, so it reads emissive-ish)
const STONE = '#8f8676'
const CHIMNEY = '#6e5a48'
const CIVIC_WALL = ['#b7ac93', '#ab9f83']
const MITRAS_WALL = ['#e2dccb', '#d6cfba', '#e9e4d5']
const MITRAS_SLATE = ['#5c6a74', '#4f5c66', '#6b7a83']
const KEEP_COLOR = '#e9e2d3'

// ---------------------------------------------------------------------------
// crush / collapse tuning + shared scratch. When a titan foot tramples a
// building it caves in over COLLAPSE_DUR into a tilted heap of rubble; a dust
// puff bursts at the moment of impact. Everything is a PURE function of frame.t
// so scrubbing the timeline backward restores buildings exactly.
// ---------------------------------------------------------------------------
const COLLAPSE_DUR = 0.7 // seconds from first contact to fully caved
const CRUSH_SCALE_Y = 0.15 // residual height fraction (a flat rubble heap)
const CRUSH_SINK = 0.4 // metres the heap settles into the ground
const DUST_DUR = 2.2 // seconds the dust puff lives past impact

// soft radial sprite — a bare mesh/Points without a radial map renders as a hard
// square; this gives the dust a feathered edge. Grey-brown, generated once.
const DUST_TEX = (() => {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,255,255,0.85)')
  grad.addColorStop(0.5, 'rgba(255,255,255,0.4)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  return new CanvasTexture(c)
})()

const DUST_PLANE = new PlaneGeometry(1, 1)

// per-frame scratch — reused, never allocated inside useFrame
const _mat = new Matrix4()
const _pos = new Vector3()
const _quat = new Quaternion()
const _q2 = new Quaternion()
const _axis = new Vector3()
const _scl = new Vector3()
const _euler = new Euler()

// deterministic seed from a district id string
function hashId(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

// ---------------------------------------------------------------------------
// geometry construction helpers — all in LOCAL space, footprint centered on
// origin, ground at y=0, walls sunk to y=-SKIRT so buildings never float.
// A "part" is a box with a flat baked color.
// ---------------------------------------------------------------------------
const SKIRT = 0.6

interface Part {
  // center + full size
  cx: number
  cy: number
  cz: number
  sx: number
  sy: number
  sz: number
  color: string
}

// bake a single flat color into a geometry's `color` attribute (in place).
// Also strips `uv` so every part shares the SAME attribute set (position,
// normal, color) — mergeGeometries requires identical attributes across parts,
// and the custom gable prism has no uv.
function bakeColor(g: BufferGeometry, color: string): BufferGeometry {
  const c = new Color(color)
  const n = g.attributes.position.count
  const arr = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r
    arr[i * 3 + 1] = c.g
    arr[i * 3 + 2] = c.b
  }
  g.setAttribute('color', new Float32BufferAttribute(arr, 3))
  if (g.hasAttribute('uv')) g.deleteAttribute('uv')
  if (g.hasAttribute('uv1')) g.deleteAttribute('uv1')
  return g
}

function box(p: Part): BufferGeometry {
  const g = new BoxGeometry(p.sx, p.sy, p.sz)
  g.translate(p.cx, p.cy, p.cz)
  return bakeColor(g, p.color)
}

// A triangular-prism gabled roof, ridge running along +z (depth). Length = depth,
// spanning width = w, height = rh, sitting with its eaves at y=base.
function gableRoof(
  w: number,
  depth: number,
  rh: number,
  base: number,
  color: string,
  overhang: number,
): BufferGeometry {
  const hw = w / 2 + overhang
  const hd = depth / 2 + overhang
  // 6 vertices: two triangular end caps
  //   front (z=-hd):  L(-hw,base), R(hw,base), Ridge(0,base+rh)
  //   back  (z=+hd):  L,R,Ridge
  const b = base
  const verts = [
    // front cap
    -hw, b, -hd, hw, b, -hd, 0, b + rh, -hd,
    // back cap
    -hw, b, hd, hw, b, hd, 0, b + rh, hd,
  ]
  // faces
  const idx = [
    // front cap (facing -z)
    0, 2, 1,
    // back cap (facing +z)
    3, 4, 5,
    // left slope (-x side): front-L, back-L, back-Ridge, front-Ridge
    0, 3, 5, 0, 5, 2,
    // right slope (+x side): front-R, front-Ridge, back-Ridge, back-R
    1, 2, 5, 1, 5, 4,
    // underside (soffit, facing down) so overhang has a dark belly
    0, 1, 4, 0, 4, 3,
  ]
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(verts, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return bakeColor(g, color)
}

// ---------------------------------------------------------------------------
// House archetype builder. Produces one merged geometry with baked colors.
// width (x) = frontage facing the street, depth (z), stories.
// ---------------------------------------------------------------------------
interface HouseSpec {
  w: number
  depth: number
  storyH: number
  stories: number
  roof: string // tile or slate hex
  plaster: string
  jetty: boolean // 2nd story overhangs front
  chimney: boolean
  litWindows: number // how many windows glow warm
  seed: number
}

function buildHouse(spec: HouseSpec): BufferGeometry {
  const { w, depth, storyH, stories, roof, plaster } = spec
  const rand = mulberry32(spec.seed)
  const parts: BufferGeometry[] = []
  const wallTop = storyH * stories
  const hw = w / 2
  const hd = depth / 2

  // -- main wall block (plaster), sunk below ground by SKIRT --
  parts.push(
    box({
      cx: 0,
      cy: (wallTop - -SKIRT) / 2 - SKIRT,
      cz: 0,
      sx: w,
      sy: wallTop + SKIRT,
      sz: depth,
      color: plaster,
    }),
  )

  // jettied upper story: a slightly wider band on the front (and sides)
  if (spec.jetty && stories >= 2) {
    const jH = storyH
    const jY = storyH + jH / 2
    const over = 0.5
    parts.push(
      box({
        cx: 0,
        cy: jY,
        cz: -over / 2,
        sx: w + over,
        sy: jH,
        sz: depth + over,
        color: plaster,
      }),
    )
    // support bracket beams under the jetty
    parts.push(
      box({ cx: -hw, cy: storyH, cz: -hd - over / 2, sx: 0.3, sy: 0.3, sz: 1.0, color: TIMBER }),
    )
    parts.push(
      box({ cx: hw, cy: storyH, cz: -hd - over / 2, sx: 0.3, sy: 0.3, sz: 1.0, color: TIMBER }),
    )
  }

  // -- exposed timber framing on the FRONT facade (fachwerk) --
  const frontZ = -hd - 0.02
  const T = 0.28 // timber thickness
  const facadeH = wallTop
  // corner posts
  parts.push(box({ cx: -hw + T / 2, cy: facadeH / 2, cz: frontZ, sx: T, sy: facadeH, sz: 0.16, color: TIMBER }))
  parts.push(box({ cx: hw - T / 2, cy: facadeH / 2, cz: frontZ, sx: T, sy: facadeH, sz: 0.16, color: TIMBER }))
  // sill + top plate + per-story rails
  for (let s = 0; s <= stories; s++) {
    const y = s * storyH
    parts.push(box({ cx: 0, cy: y, cz: frontZ, sx: w, sy: T, sz: 0.16, color: TIMBER_LIGHT }))
  }
  // vertical studs per story
  const studN = Math.max(2, Math.round(w / 2.4))
  for (let s = 0; s < stories; s++) {
    for (let k = 1; k < studN; k++) {
      const x = -hw + (w * k) / studN
      parts.push(
        box({
          cx: x,
          cy: s * storyH + storyH / 2,
          cz: frontZ,
          sx: T * 0.7,
          sy: storyH,
          sz: 0.14,
          color: TIMBER,
        }),
      )
    }
    // diagonal braces in the corner bays (the classic X / K look)
    const braceLen = Math.hypot(storyH, w / studN)
    for (const side of [-1, 1]) {
      const bx = side * (hw - w / studN / 2 - T)
      const by = s * storyH + storyH / 2
      const g = new BoxGeometry(T * 0.6, braceLen * 0.92, 0.13)
      g.rotateZ(side * Math.atan2(w / studN, storyH))
      g.translate(bx, by, frontZ)
      parts.push(bakeColor(g, TIMBER))
    }
  }

  // -- recessed door on the ground floor, offset to one side --
  const doorW = 1.2
  const doorH = Math.min(2.2, storyH - 0.6)
  const doorX = range(rand, -hw + 1.4, hw - 1.4) * 0.5
  parts.push(
    box({ cx: doorX, cy: doorH / 2, cz: frontZ - 0.12, sx: doorW, sy: doorH, sz: 0.22, color: DOOR }),
  )
  // door lintel timber
  parts.push(
    box({ cx: doorX, cy: doorH + 0.12, cz: frontZ, sx: doorW + 0.4, sy: 0.24, sz: 0.16, color: TIMBER }),
  )

  // -- windows: insets, some warm-lit. Grid across each story, skipping door bay. --
  const winW = 0.85
  const winH = 1.0
  const cols = Math.max(1, studN - 1)
  let litLeft = spec.litWindows
  for (let s = 0; s < stories; s++) {
    const wy = s * storyH + storyH * 0.58
    for (let k = 0; k < cols; k++) {
      const wx = -hw + (w * (k + 1)) / (cols + 1)
      // ground floor: skip the bay containing the door
      if (s === 0 && Math.abs(wx - doorX) < doorW) continue
      if (rand() < 0.15) continue // some blank panels
      const lit = litLeft > 0 && rand() < 0.5
      if (lit) litLeft--
      parts.push(
        box({
          cx: wx,
          cy: wy,
          cz: frontZ - 0.1,
          sx: winW,
          sy: winH,
          sz: 0.2,
          color: lit ? WINDOW_LIT : WINDOW_DARK,
        }),
      )
      // window frame timber (cross mullion)
      parts.push(box({ cx: wx, cy: wy, cz: frontZ - 0.02, sx: winW + 0.18, sy: 0.1, sz: 0.14, color: TIMBER }))
      parts.push(box({ cx: wx, cy: wy, cz: frontZ - 0.02, sx: 0.1, sy: winH + 0.18, sz: 0.14, color: TIMBER }))
    }
  }

  // -- gabled roof: ridge runs along depth so the gable end faces the street --
  const roofH = Math.max(2.2, w * 0.42)
  parts.push(gableRoof(w, depth, roofH, wallTop, roof, 0.6))
  // ridge cap
  parts.push(
    box({ cx: 0, cy: wallTop + roofH, cz: 0, sx: 0.4, sy: 0.3, sz: depth + 1.0, color: RIDGE }),
  )

  // -- chimney (stone) rising from the roof toward the back --
  if (spec.chimney) {
    const chX = range(rand, -hw * 0.5, hw * 0.5)
    const chZ = hd * 0.4
    // height so it clears the sloped roof at that x
    const roofAtX = wallTop + roofH * (1 - Math.abs(chX) / (w / 2 + 0.6))
    const chTop = roofAtX + range(rand, 1.4, 2.6)
    parts.push(
      box({
        cx: chX,
        cy: (chTop + wallTop * 0.6) / 2,
        cz: chZ,
        sx: 0.9,
        sy: chTop - wallTop * 0.6,
        sz: 0.9,
        color: CHIMNEY,
      }),
    )
    // chimney cap
    parts.push(box({ cx: chX, cy: chTop, cz: chZ, sx: 1.1, sy: 0.25, sz: 1.1, color: STONE }))
  }

  const merged = mergeGeometries(parts, false)
  return merged ?? new BufferGeometry()
}

// long guildhall / warehouse — low, wide, ridge along its long axis (x)
function buildGuildhall(seed: number): BufferGeometry {
  const rand = mulberry32(seed)
  const w = range(rand, 22, 30) // long frontage
  const depth = range(rand, 12, 16)
  const storyH = 5.5
  const wallTop = storyH * 2
  const parts: BufferGeometry[] = []
  const hw = w / 2
  const hd = depth / 2
  const plaster = CIVIC_WALL[Math.floor(rand() * CIVIC_WALL.length)]

  parts.push(
    box({ cx: 0, cy: (wallTop + SKIRT) / 2 - SKIRT, cz: 0, sx: w, sy: wallTop + SKIRT, sz: depth, color: plaster }),
  )
  // stone base course
  parts.push(box({ cx: 0, cy: 1.0 - SKIRT / 2, cz: -hd - 0.03, sx: w, sy: 2.0 + SKIRT, sz: 0.2, color: STONE }))

  // heavy timber posts across the long front
  const bays = Math.round(w / 4)
  for (let k = 0; k <= bays; k++) {
    const x = -hw + (w * k) / bays
    parts.push(box({ cx: x, cy: wallTop / 2, cz: -hd - 0.02, sx: 0.4, sy: wallTop, sz: 0.16, color: TIMBER }))
  }
  parts.push(box({ cx: 0, cy: 0, cz: -hd - 0.02, sx: w, sy: 0.4, sz: 0.16, color: TIMBER }))
  parts.push(box({ cx: 0, cy: storyH, cz: -hd - 0.02, sx: w, sy: 0.4, sz: 0.16, color: TIMBER }))
  parts.push(box({ cx: 0, cy: wallTop, cz: -hd - 0.02, sx: w, sy: 0.4, sz: 0.16, color: TIMBER }))

  // big central cargo doors
  parts.push(box({ cx: 0, cy: 1.7, cz: -hd - 0.13, sx: 3.2, sy: 3.4, sz: 0.24, color: DOOR }))
  // upper-story loading window, lit
  parts.push(box({ cx: 0, cy: storyH + storyH * 0.55, cz: -hd - 0.11, sx: 1.6, sy: 1.4, sz: 0.2, color: WINDOW_LIT }))

  // roof ridge along x (rotate the gable prism 90°)
  const roofH = depth * 0.5
  const rg = gableRoof(depth, w, roofH, wallTop, ROOF_TILE[Math.floor(rand() * ROOF_TILE.length)], 0.7)
  rg.rotateY(Math.PI / 2)
  parts.push(rg)
  parts.push(box({ cx: 0, cy: wallTop + roofH, cz: 0, sx: w + 1.0, sy: 0.35, sz: 0.45, color: RIDGE }))

  const merged = mergeGeometries(parts, false)
  return merged ?? new BufferGeometry()
}

// small church / bell-tower for district centers
function buildChurch(): BufferGeometry {
  const parts: BufferGeometry[] = []
  const navW = 12
  const navD = 22
  const navH = 12
  const plaster = '#c9bfa8'
  // nave
  parts.push(box({ cx: 0, cy: (navH + SKIRT) / 2 - SKIRT, cz: 0, sx: navW, sy: navH + SKIRT, sz: navD, color: plaster }))
  // stone buttress base
  parts.push(box({ cx: 0, cy: 1.2 - SKIRT / 2, cz: 0, sx: navW + 0.5, sy: 2.4 + SKIRT, sz: navD + 0.5, color: STONE }))
  // gabled roof along depth
  const rh = navW * 0.55
  parts.push(gableRoof(navW, navD, rh, navH, ROOF_SLATE[0], 0.6))
  parts.push(box({ cx: 0, cy: navH + rh, cz: 0, sx: 0.4, sy: 0.3, sz: navD + 1, color: RIDGE }))
  // tall arched windows (lit) along the front gable
  for (const wx of [-3, 0, 3]) {
    parts.push(box({ cx: wx, cy: navH * 0.55, cz: -navD / 2 - 0.08, sx: 1.0, sy: 4.0, sz: 0.2, color: WINDOW_LIT }))
  }
  // bell tower at the front
  const towX = 0
  const towZ = -navD / 2 - 3
  const towW = 6
  const towH = 26
  parts.push(box({ cx: towX, cy: (towH + SKIRT) / 2 - SKIRT, cz: towZ, sx: towW, sy: towH + SKIRT, sz: towW, color: STONE }))
  // belfry openings (dark)
  for (const s of [-1, 1]) {
    parts.push(box({ cx: towX + s * (towW / 2 - 0.05), cy: towH - 4, cz: towZ, sx: 0.2, sy: 3, sz: 1.6, color: WINDOW_DARK }))
    parts.push(box({ cx: towX, cy: towH - 4, cz: towZ + s * (towW / 2 - 0.05), sx: 1.6, sy: 3, sz: 0.2, color: WINDOW_DARK }))
  }
  // spire (steep pyramid = a tall gable both ways -> use a slim tall gable rotated is complex;
  // approximate with a steep 4-slope by two crossed gables)
  const spireH = 12
  const g1 = gableRoof(towW, towW, spireH, towH, ROOF_SLATE[1], 0.3)
  g1.translate(towX, 0, towZ)
  parts.push(g1)
  const g2 = gableRoof(towW, towW, spireH, towH, ROOF_SLATE[1], 0.3)
  g2.rotateY(Math.PI / 2)
  g2.translate(towX, 0, towZ)
  parts.push(g2)

  const merged = mergeGeometries(parts, false)
  return merged ?? new BufferGeometry()
}

// ---------------------------------------------------------------------------
// Archetype set. Index into ARCHETYPES chooses which InstancedMesh an
// instance lands in. 0..N-1 houses, then guildhall, church.
// ---------------------------------------------------------------------------
function buildArchetypes(mitras: boolean) {
  const geos: BufferGeometry[] = []
  const roofPalette = mitras ? MITRAS_SLATE : [...ROOF_TILE, ...ROOF_SLATE]
  const wallPalette = mitras ? MITRAS_WALL : PLASTER
  // 6 house variants: mix of 1 and 2 story, jettied, chimney, sizes
  const specs: Omit<HouseSpec, 'seed'>[] = [
    { w: 7.5, depth: 8, storyH: 3.6, stories: 1, roof: roofPalette[0], plaster: wallPalette[0], jetty: false, chimney: true, litWindows: 1 },
    { w: 8.5, depth: 9, storyH: 3.6, stories: 2, roof: roofPalette[1 % roofPalette.length], plaster: wallPalette[1 % wallPalette.length], jetty: true, chimney: true, litWindows: 2 },
    { w: 9.5, depth: 10, storyH: 3.8, stories: 2, roof: roofPalette[2 % roofPalette.length], plaster: wallPalette[2 % wallPalette.length], jetty: false, chimney: true, litWindows: 1 },
    { w: 6.5, depth: 7.5, storyH: 3.4, stories: 1, roof: roofPalette[3 % roofPalette.length], plaster: wallPalette[3 % wallPalette.length], jetty: false, chimney: false, litWindows: 0 },
    { w: 10, depth: 8.5, storyH: 3.7, stories: 2, roof: roofPalette[4 % roofPalette.length], plaster: wallPalette[4 % wallPalette.length], jetty: true, chimney: true, litWindows: 3 },
    { w: 8, depth: 12, storyH: 3.6, stories: 2, roof: roofPalette[0], plaster: wallPalette[(mitras ? 0 : 2)], jetty: false, chimney: true, litWindows: 2 },
  ]
  specs.forEach((s, i) => geos.push(buildHouse({ ...s, seed: hashId((mitras ? 'm' : 'h') + i) })))
  const HOUSE_N = geos.length
  geos.push(buildGuildhall(hashId((mitras ? 'm' : 'h') + 'guild')))
  const GUILD_I = geos.length - 1
  geos.push(buildChurch())
  const CHURCH_I = geos.length - 1
  return { geos, HOUSE_N, GUILD_I, CHURCH_I }
}

// ---------------------------------------------------------------------------
// Placement: an instance = { archetype index, x, z, yaw, tint }.
// ---------------------------------------------------------------------------
interface Placement {
  a: number
  x: number
  z: number
  yaw: number
  tint: number // multiplier 0.9..1.05
  // which episode's titan tracks can crush this building ('ep1' for Shiganshina,
  // 'ep2' for Trost, undefined elsewhere — those stay pristine, zero per-frame cost)
  crushEp?: 'ep1' | 'ep2'
}

function layoutDistrict(
  dd: DistrictDef,
  houseTarget: number,
  HOUSE_N: number,
  GUILD_I: number,
  CHURCH_I: number,
): Placement[] {
  const rand = mulberry32(hashId(dd.id))
  const C = districtGateCenter(dd)
  const o = districtOutward(dd)
  const l: [number, number, number] = [Math.cos(dd.angle), 0, -Math.sin(dd.angle)]
  const baseYaw = Math.atan2(o[0], o[2]) // gable end faces down the street

  // only the two districts an episode actually plays out in take damage
  const crushEp: 'ep1' | 'ep2' | undefined =
    dd.id === 'shiganshina' ? 'ep1' : dd.id === 'trost' ? 'ep2' : undefined

  const out: Placement[] = []

  const CELL_U = 14
  const CELL_V = 12
  const U_MIN = 35
  const U_MAX = 520
  // spread houses across the WHOLE semicircular district: filling gate-outward
  // and stopping at the target packs everything against the gate and leaves the
  // outer half (where the breach plays out) an empty field. Instead estimate the
  // usable cell count and decimate uniformly.
  const discArea = (Math.PI / 2) * (DISTRICT_R - 25) * (DISTRICT_R - 25)
  const usableCells = (discArea / (CELL_U * CELL_V)) * 0.7
  const keepP = Math.min(1, houseTarget / usableCells)
  const cap = Math.ceil(houseTarget * 1.2)
  let placed = 0

  let ui = 0
  for (let u = U_MIN; u < U_MAX && placed < cap; u += CELL_U, ui++) {
    const crossStreet = ui > 0 && ui % 5 === 0
    if (crossStreet) continue
    const halfV = Math.sqrt(Math.max(0, DISTRICT_R * DISTRICT_R - u * u)) - 25
    if (halfV <= 20) continue

    let vi = 0
    for (let v = -halfV; v <= halfV; v += CELL_V, vi++) {
      if (placed >= cap) break
      if (vi > 0 && vi % 7 === 0) continue
      if (Math.abs(v) < 16) continue // main street
      if (u < 60 && Math.abs(v) < 60) continue // plaza
      if (rand() > keepP) continue

      const ju = u + range(rand, -3, 3)
      const jv = v + range(rand, -2.5, 2.5)
      const hv = Math.sqrt(Math.max(0, DISTRICT_R * DISTRICT_R - ju * ju)) - 25
      if (ju < U_MIN || ju > U_MAX || Math.abs(jv) > hv) continue

      const wx = C[0] + o[0] * ju + l[0] * jv
      const wz = C[2] + o[2] * ju + l[2] * jv

      // houses on the +v side face the street (baseYaw); -v side rotated 180 to face back across
      const face = v < 0 ? baseYaw + Math.PI : baseYaw
      out.push({
        a: Math.floor(rand() * HOUSE_N),
        x: wx,
        z: wz,
        yaw: face + range(rand, -0.05, 0.05),
        tint: range(rand, 0.9, 1.05),
        crushEp,
      })
      placed++
    }
  }

  // civic buildings near the plaza: church (district center) + warehouse
  const placeCivic = (a: number, cu: number, cvSign: number) => {
    const cv = cvSign * range(rand, 66, 110)
    const wx = C[0] + o[0] * cu + l[0] * cv
    const wz = C[2] + o[2] * cu + l[2] * cv
    out.push({ a, x: wx, z: wz, yaw: baseYaw + range(rand, -0.03, 0.03), tint: range(rand, 0.95, 1.05), crushEp })
  }
  if (dd.named) placeCivic(CHURCH_I, range(rand, 40, 55), -1)
  if (dd.id === 'shiganshina' || dd.named) placeCivic(GUILD_I, range(rand, 70, 120), 1)

  return out
}

function layoutMitras(HOUSE_N: number, GUILD_I: number, CHURCH_I: number): Placement[] {
  const rand = mulberry32(hashId('mitras-capital'))
  const out: Placement[] = []
  const CLUSTER_R = 400
  const KEEP_CLEAR = 90
  const n = 150
  let placed = 0
  let guard = 0
  while (placed < n && guard < n * 6) {
    guard++
    const rr = Math.sqrt(rand()) * CLUSTER_R
    if (rr < KEEP_CLEAR) continue
    const th = rand() * Math.PI * 2
    const wx = Math.cos(th) * rr
    const wz = Math.sin(th) * rr
    // roughly radial, gable facing the center
    const yaw = Math.atan2(wx, wz) + range(rand, -0.15, 0.15)
    const roll = rand()
    const a = roll < 0.08 ? CHURCH_I : roll < 0.16 ? GUILD_I : Math.floor(rand() * HOUSE_N)
    out.push({ a, x: wx, z: wz, yaw, tint: range(rand, 0.92, 1.05) })
    placed++
  }
  return out
}

// ---------------------------------------------------------------------------
// Street furniture — sparse, instanced, deterministic. Merged archetypes too.
// ---------------------------------------------------------------------------
function buildWell(): BufferGeometry {
  const parts: BufferGeometry[] = []
  parts.push(box({ cx: 0, cy: 0.5, cz: 0, sx: 2.2, sy: 1.0, sz: 2.2, color: STONE }))
  parts.push(box({ cx: -1, cy: 2.2, cz: 0, sx: 0.25, sy: 2.6, sz: 0.25, color: TIMBER }))
  parts.push(box({ cx: 1, cy: 2.2, cz: 0, sx: 0.25, sy: 2.6, sz: 0.25, color: TIMBER }))
  // little gable canopy over it (tile)
  parts.push(gableRoof(2.6, 2.6, 1.2, 3.4, ROOF_TILE[0], 0.2))
  return mergeGeometries(parts, false) ?? new BufferGeometry()
}
function buildStall(): BufferGeometry {
  const parts: BufferGeometry[] = []
  // counter
  parts.push(box({ cx: 0, cy: 0.5, cz: 0, sx: 3.0, sy: 1.0, sz: 1.4, color: '#5a4632' }))
  // posts
  for (const sx of [-1.3, 1.3]) for (const sz of [-0.6, 0.6])
    parts.push(box({ cx: sx, cy: 1.4, cz: sz, sx: 0.14, sy: 2.8, sz: 0.14, color: TIMBER }))
  // striped canvas awning (a shallow gable), warm off-white canvas
  parts.push(gableRoof(3.4, 2.0, 0.7, 2.8, '#c9b487', 0.25))
  return mergeGeometries(parts, false) ?? new BufferGeometry()
}
function buildCart(): BufferGeometry {
  const parts: BufferGeometry[] = []
  parts.push(box({ cx: 0, cy: 0.9, cz: 0, sx: 2.4, sy: 0.5, sz: 1.2, color: '#6b533a' }))
  parts.push(box({ cx: 0, cy: 1.25, cz: -0.55, sx: 2.4, sy: 0.5, sz: 0.12, color: '#5a4632' }))
  // wheels
  for (const sx of [-0.8, 0.8]) {
    const w1 = new CylinderGeometry(0.6, 0.6, 0.18, 10)
    w1.rotateZ(Math.PI / 2)
    w1.translate(sx, 0.6, 0.6)
    bakeColor(w1, '#3a2c20')
    parts.push(w1)
    const w2 = w1.clone(); w2.translate(0, 0, -1.2); parts.push(w2)
  }
  // shafts
  parts.push(box({ cx: 0, cy: 0.9, cz: 1.6, sx: 0.12, sy: 0.12, sz: 1.8, color: TIMBER }))
  return mergeGeometries(parts, false) ?? new BufferGeometry()
}
function buildBarrels(): BufferGeometry {
  const parts: BufferGeometry[] = []
  const rand = mulberry32(4242)
  const placeBarrel = (x: number, z: number, r: number, h: number) => {
    const b = new CylinderGeometry(r, r * 0.92, h, 9)
    b.translate(x, h / 2, z)
    bakeColor(b, '#5e4a34')
    parts.push(b)
  }
  placeBarrel(0, 0, 0.5, 1.2)
  placeBarrel(1.1, 0.2, 0.5, 1.2)
  placeBarrel(0.5, 1.0, 0.5, 1.2)
  // a couple of crates
  parts.push(box({ cx: -1.0, cy: 0.5, cz: 0.3, sx: 1.0, sy: 1.0, sz: 1.0, color: '#6b533a' }))
  parts.push(box({ cx: -0.7, cy: 1.3, cz: -0.4, sx: 0.8, sy: 0.8, sz: 0.8, color: '#5a4632' }))
  void rand
  return mergeGeometries(parts, false) ?? new BufferGeometry()
}

interface FurniturePlacement {
  x: number
  z: number
  yaw: number
}

function layoutFurniture(): {
  wells: FurniturePlacement[]
  stalls: FurniturePlacement[]
  carts: FurniturePlacement[]
  barrels: FurniturePlacement[]
} {
  const wells: FurniturePlacement[] = []
  const stalls: FurniturePlacement[] = []
  const carts: FurniturePlacement[] = []
  const barrels: FurniturePlacement[] = []

  for (const dd of DISTRICTS) {
    const rand = mulberry32(hashId(dd.id + '-furniture'))
    const C = districtGateCenter(dd)
    const o = districtOutward(dd)
    const l: [number, number, number] = [Math.cos(dd.angle), 0, -Math.sin(dd.angle)]
    const baseYaw = Math.atan2(o[0], o[2])
    const at = (u: number, v: number): [number, number] => [
      C[0] + o[0] * u + l[0] * v,
      C[2] + o[2] * u + l[2] * v,
    ]
    // one well in the plaza
    {
      const [x, z] = at(range(rand, 35, 50), range(rand, -12, 12))
      wells.push({ x, z, yaw: rand() * Math.PI * 2 })
    }
    // market stalls lining the plaza
    const stallN = dd.id === 'shiganshina' ? 6 : dd.named ? 4 : 2
    for (let i = 0; i < stallN; i++) {
      const [x, z] = at(range(rand, 40, 70), (i % 2 === 0 ? -1 : 1) * range(rand, 22, 45))
      stalls.push({ x, z, yaw: baseYaw + (i % 2 === 0 ? 0.4 : -0.4) })
    }
    // a few carts + barrel clusters scattered along side lanes
    const cartN = dd.named ? 3 : 1
    for (let i = 0; i < cartN; i++) {
      const [x, z] = at(range(rand, 60, 180), range(rand, -140, 140) * (rand() < 0.5 ? 1 : -1) * 0.4 + (rand() < 0.5 ? 20 : -20))
      carts.push({ x, z, yaw: rand() * Math.PI * 2 })
    }
    const barrelN = dd.named ? 4 : 2
    for (let i = 0; i < barrelN; i++) {
      const [x, z] = at(range(rand, 55, 200), (rand() < 0.5 ? 1 : -1) * range(rand, 20, 90))
      barrels.push({ x, z, yaw: rand() * Math.PI * 2 })
    }
  }
  return { wells, stalls, carts, barrels }
}

// ---------------------------------------------------------------------------
// Crush precompute. For a crushable placement, find the earliest track sample
// whose footprint overlaps the building's own footprint. halfExt is an
// approximate horizontal half-extent of the archetype (~0.6 × max(w, depth)).
// Returns undefined if no titan ever reaches this building.
// ---------------------------------------------------------------------------
function earliestCrushT(
  x: number,
  z: number,
  halfExt: number,
  tracks: TitanTrack[],
): number | undefined {
  let best: number | undefined
  for (let i = 0; i < tracks.length; i++) {
    const s = tracks[i]
    const reach = s.r + halfExt
    const dx = x - s.x
    const dz = z - s.z
    if (dx * dx + dz * dz < reach * reach) {
      if (best === undefined || s.t < best) best = s.t
    }
  }
  return best
}

// one crushable instance: its base transform plus the precomputed crush schedule
interface Crushable {
  i: number // instance index in the InstancedMesh
  x: number
  z: number
  yaw: number
  crushT: number
  ep: 'ep1' | 'ep2'
  // seeded rubble tilt: a horizontal axis (unit) + a target lean angle
  axX: number
  axZ: number
  lean: number
}

// ---------------------------------------------------------------------------
// A generic instanced-archetype mesh: one geometry, N placements, baked tint.
// If any placement carries a crushEp, those instances collapse under titan
// feet per frame (pure function of frame.t) and spawn deterministic dust; all
// other instances — and meshes with no crushable placements at all — stay
// fully static with zero per-frame work.
// ---------------------------------------------------------------------------
function ArchetypeMesh({
  geometry,
  placements,
  roughness,
}: {
  geometry: BufferGeometry
  placements: Placement[] | { x: number; z: number; yaw: number; tint?: number }[]
  roughness: number
}) {
  const ref = useRef<InstancedMesh>(null)
  const dustRef = useRef<InstancedMesh>(null)

  // approximate footprint half-extent from the archetype's own bounding box
  const halfExt = useMemo(() => {
    geometry.computeBoundingBox()
    const bb = geometry.boundingBox
    if (!bb) return 3
    return 0.6 * Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z)
  }, [geometry])

  // precompute the crushable subset (empty for furniture / undamaged districts)
  const crushables = useMemo(() => {
    const list: Crushable[] = []
    for (let i = 0; i < placements.length; i++) {
      const p = placements[i] as Placement
      const ep = p.crushEp
      if (!ep) continue
      const tracks = ep === 'ep1' ? EP1_TITAN_TRACKS : EP2_TITAN_TRACKS
      const crushT = earliestCrushT(p.x, p.z, halfExt, tracks)
      if (crushT === undefined) continue
      // seed a tilt axis + lean from the building position so rubble reads
      // varied but is fully deterministic (no Math.random at render time)
      const seed = hashId(`${ep}:${Math.round(p.x)}:${Math.round(p.z)}:${i}`)
      const r = mulberry32(seed)
      const ang = r() * Math.PI * 2
      list.push({
        i,
        x: p.x,
        z: p.z,
        yaw: p.yaw,
        crushT,
        ep,
        axX: Math.cos(ang),
        axZ: Math.sin(ang),
        lean: range(r, 0.1, 0.25),
      })
    }
    return list
  }, [placements, halfExt])

  // bake the base (undamaged) matrices + tint once
  useLayoutEffect(() => {
    const m = ref.current
    if (!m) return
    const dummy = new Object3D()
    const col = new Color()
    for (let i = 0; i < placements.length; i++) {
      const p = placements[i]
      dummy.position.set(p.x, 0, p.z)
      dummy.rotation.set(0, p.yaw, 0)
      dummy.scale.set(1, 1, 1)
      dummy.updateMatrix()
      m.setMatrixAt(i, dummy.matrix)
      const t = p.tint ?? 1
      col.setRGB(t, t, t)
      m.setColorAt(i, col)
    }
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
  }, [placements])

  // per-frame collapse — ONLY touches the crushable subset. Skipped entirely
  // (component still mounts) when nothing here is crushable.
  const hasCrush = crushables.length > 0
  useFrame(({ camera }) => {
    if (!hasCrush) return
    const m = ref.current
    const dust = dustRef.current
    if (!m) return
    const frame = getFrame()
    const t = frame.t
    let matChanged = false

    for (let k = 0; k < crushables.length; k++) {
      const c = crushables[k]
      const active = frame.id === c.ep
      // collapse progress 0..1 (0 = pristine, 1 = flattened). Backwards scrub or
      // an inactive episode restores the exact pristine matrix.
      const prog = active ? Math.min(1, Math.max(0, (t - c.crushT) / COLLAPSE_DUR)) : 0

      _pos.set(c.x, 0, c.z)
      if (prog <= 0) {
        // pristine — identity rotation about y = base matrix
        _euler.set(0, c.yaw, 0)
        _quat.setFromEuler(_euler)
        _scl.set(1, 1, 1)
      } else {
        // ease-out so the cave-in snaps then settles
        const e = 1 - (1 - prog) * (1 - prog)
        _pos.y = -CRUSH_SINK * e
        const sy = 1 - (1 - CRUSH_SCALE_Y) * e
        // widen slightly as it flattens so it reads as spreading rubble
        const sxz = 1 + 0.18 * e
        _scl.set(sxz, sy, sxz)
        // yaw about vertical, then lean over a seeded horizontal axis
        _euler.set(0, c.yaw, 0)
        _quat.setFromEuler(_euler)
        _q2.setFromAxisAngle(_axis.set(c.axX, 0, c.axZ), c.lean * e)
        _quat.premultiply(_q2)
      }
      _mat.compose(_pos, _quat, _scl)
      m.setMatrixAt(c.i, _mat)
      matChanged = true
    }
    if (matChanged) m.instanceMatrix.needsUpdate = true

    // dust puffs — one billboarded sprite per crushable, alive in the impact
    // window [crushT, crushT + DUST_DUR], expanding + fading. Fully in t.
    if (dust) {
      for (let k = 0; k < crushables.length; k++) {
        const c = crushables[k]
        const active = frame.id === c.ep
        const age = active ? t - c.crushT : -1
        if (age < 0 || age > DUST_DUR) {
          _pos.set(0, -1000, 0)
          _scl.setScalar(0)
          _quat.identity()
          _mat.compose(_pos, _quat, _scl)
          dust.setMatrixAt(k, _mat)
          continue
        }
        const life = age / DUST_DUR
        const size = (6 + life * 22) * Math.max(0.7, halfExt / 4)
        _pos.set(c.x, halfExt * 0.5 + life * 6, c.z)
        _quat.copy(camera.quaternion) // billboard
        _scl.set(size, size, 1)
        _mat.compose(_pos, _quat, _scl)
        dust.setMatrixAt(k, _mat)
      }
      dust.instanceMatrix.needsUpdate = true
    }
  })

  const dustMat = useMemo(
    () =>
      new MeshBasicMaterial({
        color: 0x8a7a66, // grey-brown
        map: DUST_TEX,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
      }),
    [],
  )

  return (
    <group>
      <instancedMesh
        ref={ref}
        args={[geometry, undefined, Math.max(1, placements.length)]}
        castShadow
        receiveShadow
        frustumCulled={false}
      >
        <meshStandardMaterial vertexColors roughness={roughness} metalness={0} />
      </instancedMesh>
      {hasCrush && (
        <instancedMesh
          ref={dustRef}
          args={[DUST_PLANE, dustMat, crushables.length]}
          frustumCulled={false}
        />
      )}
    </group>
  )
}

export function Town() {
  const bodyRef = useRef<InstancedMesh>(null)

  // Build district + mitras archetypes (separate palettes).
  const district = useMemo(() => buildArchetypes(false), [])
  const mitrasArch = useMemo(() => buildArchetypes(true), [])

  // Placements, grouped by archetype index.
  const { districtGroups, mitrasGroups } = useMemo(() => {
    const dAll: Placement[] = []
    for (const dd of DISTRICTS) {
      const target = dd.id === 'shiganshina' ? 1500 : dd.named ? 550 : 300
      dAll.push(
        ...layoutDistrict(dd, target, district.HOUSE_N, district.GUILD_I, district.CHURCH_I),
      )
    }
    const mAll = layoutMitras(mitrasArch.HOUSE_N, mitrasArch.GUILD_I, mitrasArch.CHURCH_I)
    const group = (all: Placement[], count: number) => {
      const g: Placement[][] = Array.from({ length: count }, () => [])
      for (const p of all) g[p.a].push(p)
      return g
    }

    // one-time report of how many buildings each episode's titans crush,
    // mirroring the per-archetype test in ArchetypeMesh (same half-extents).
    const halfExts = district.geos.map((g) => {
      g.computeBoundingBox()
      const bb = g.boundingBox
      return bb ? 0.6 * Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) : 3
    })
    let ep1n = 0
    let ep2n = 0
    for (const p of dAll) {
      if (!p.crushEp) continue
      const tracks = p.crushEp === 'ep1' ? EP1_TITAN_TRACKS : EP2_TITAN_TRACKS
      if (earliestCrushT(p.x, p.z, halfExts[p.a], tracks) !== undefined) {
        if (p.crushEp === 'ep1') ep1n++
        else ep2n++
      }
    }
    console.debug(`[Town] crushable buildings — ep1(Shiganshina): ${ep1n}, ep2(Trost): ${ep2n}`)

    return {
      districtGroups: group(dAll, district.geos.length),
      mitrasGroups: group(mAll, mitrasArch.geos.length),
    }
  }, [district, mitrasArch])

  const furniture = useMemo(() => layoutFurniture(), [])
  const wellGeo = useMemo(() => buildWell(), [])
  const stallGeo = useMemo(() => buildStall(), [])
  const cartGeo = useMemo(() => buildCart(), [])
  const barrelGeo = useMemo(() => buildBarrels(), [])

  // Mitras central keep: a tall cylindrical tower + smaller flanking towers.
  const keep = useMemo(() => {
    const rand = mulberry32(hashId('mitras-keep'))
    const towers: { x: number; z: number; r: number; h: number }[] = []
    towers.push({ x: 0, z: 0, r: 18, h: 70 })
    const ring = 5
    for (let i = 0; i < ring; i++) {
      const th = (i / ring) * Math.PI * 2
      const rr = 34
      towers.push({ x: Math.cos(th) * rr, z: Math.sin(th) * rr, r: range(rand, 7, 10), h: range(rand, 34, 46) })
    }
    return towers
  }, [])

  const keepGeo = useMemo(() => new CylinderGeometry(1, 1, 1, 12), [])

  void bodyRef

  return (
    <group>
      {district.geos.map((g, i) => (
        <ArchetypeMesh key={`d${i}`} geometry={g} placements={districtGroups[i]} roughness={0.92} />
      ))}
      {mitrasArch.geos.map((g, i) => (
        <ArchetypeMesh key={`m${i}`} geometry={g} placements={mitrasGroups[i]} roughness={0.88} />
      ))}

      <ArchetypeMesh geometry={wellGeo} placements={furniture.wells} roughness={0.95} />
      <ArchetypeMesh geometry={stallGeo} placements={furniture.stalls} roughness={0.95} />
      <ArchetypeMesh geometry={cartGeo} placements={furniture.carts} roughness={0.95} />
      <ArchetypeMesh geometry={barrelGeo} placements={furniture.barrels} roughness={0.95} />

      {/* Mitras central keep + flanking towers (unique meshes) */}
      {keep.map((t, i) => (
        <mesh
          key={i}
          geometry={keepGeo}
          position={[t.x, t.h / 2, t.z]}
          scale={[t.r, t.h, t.r]}
          castShadow
          receiveShadow
        >
          <meshStandardMaterial color={KEEP_COLOR} roughness={0.8} metalness={0} />
        </mesh>
      ))}
      {keep.map((t, i) => (
        <mesh key={`cap-${i}`} position={[t.x, t.h + t.r * 0.9, t.z]} castShadow>
          <coneGeometry args={[t.r * 1.1, t.r * 1.9, 8]} />
          <meshStandardMaterial color={MITRAS_SLATE[1]} roughness={0.7} metalness={0} />
        </mesh>
      ))}
    </group>
  )
}
