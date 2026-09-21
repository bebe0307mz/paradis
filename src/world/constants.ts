// Scale doctrine: 1 unit = 1 meter. All HEIGHTS and district footprints are
// true to canon (walls 50m, Colossal Titan 60m, houses ~8m, people 1.7m).
// Only the empty countryside BETWEEN walls is compressed ~1:40 so the whole
// island fits in one seamless float-safe scene (canon radii 250/380/480 km).

export const WALL_H = 50
export const WALL_T = 12

export const SINA_R = 6250
export const ROSE_R = 9500
export const MARIA_R = 12000

export const DISTRICT_R = 550 // semicircular district bulge radius
export const GATE_W = 30 // gate opening width
export const GATE_H = 42 // gate arch height

export const ISLAND_R = 16000

export interface DistrictDef {
  id: string
  name: string
  wall: 'maria' | 'rose' | 'sina'
  wallR: number
  /** angle in radians around the island center; 0 = south (+Z), CCW */
  angle: number
  named: boolean
}

const d = (
  id: string,
  name: string,
  wall: DistrictDef['wall'],
  wallR: number,
  deg: number,
  named = true,
): DistrictDef => ({ id, name, wall, wallR, angle: (deg * Math.PI) / 180, named })

export const DISTRICTS: DistrictDef[] = [
  // Wall Maria — only Shiganshina is named in canon
  d('shiganshina', 'Shiganshina', 'maria', MARIA_R, 0),
  d('maria-e', 'District ???', 'maria', MARIA_R, 90, false),
  d('maria-n', 'District ???', 'maria', MARIA_R, 180, false),
  d('maria-w', 'District ???', 'maria', MARIA_R, 270, false),
  // Wall Rose
  d('trost', 'Trost', 'rose', ROSE_R, 0),
  d('karanese', 'Karanese', 'rose', ROSE_R, 90),
  d('utopia', 'Utopia', 'rose', ROSE_R, 180),
  d('krolva', 'Krolva', 'rose', ROSE_R, 270),
  // Wall Sina
  d('orvud', 'Orvud', 'sina', SINA_R, 0),
  d('stohess', 'Stohess', 'sina', SINA_R, 90),
  d('yarckel', 'Yarckel', 'sina', SINA_R, 180),
  d('ermiha', 'Ermiha', 'sina', SINA_R, 270),
]

/** world-space position on a wall ring. angle 0 = south (+Z), CCW when viewed from above */
export function ringPos(r: number, angle: number, y = 0): [number, number, number] {
  return [Math.sin(angle) * r, y, Math.cos(angle) * r]
}

/** center of the district's semicircular bulge (sits ON the wall, bulging outward) */
export function districtGateCenter(dd: DistrictDef): [number, number, number] {
  return ringPos(dd.wallR, dd.angle)
}

/** outward unit direction at a district (away from island center) */
export function districtOutward(dd: DistrictDef): [number, number, number] {
  return [Math.sin(dd.angle), 0, Math.cos(dd.angle)]
}

export const SHIGANSHINA = DISTRICTS[0]
// Shiganshina landmark points (world space, district is at south: +Z)
export const SHI_INNER_GATE: [number, number, number] = [0, 0, MARIA_R] // through Wall Maria
export const SHI_OUTER_GATE: [number, number, number] = [0, 0, MARIA_R + DISTRICT_R] // through district wall

export const TROST = DISTRICTS[4]
// Trost landmark points (Wall Rose south, same south-facing layout)
export const TRO_INNER_GATE: [number, number, number] = [0, 0, ROSE_R] // through Wall Rose
export const TRO_OUTER_GATE: [number, number, number] = [0, 0, ROSE_R + DISTRICT_R] // through district wall
