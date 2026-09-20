export type Vec3 = [number, number, number]

export type TitanKind = 'colossal' | 'armored' | 'pure'

export interface TitanState {
  id: string
  kind: TitanKind
  /** total height in meters (colossal 60, armored 15, pures 4–15) */
  height: number
  pos: Vec3
  /** facing, radians around Y. 0 faces +Z */
  yaw: number
  /** walk-cycle phase driver; 0 = standing still */
  walkSpeed: number
  /** 0 = not eating; else 0..1 progress of the grab-lift-bite cycle */
  eating: number
  /** 0..1 crouch/wind-up amount (colossal kick, armored charge lean) */
  crouch: number
  /** running (armored charge) — component may exaggerate gait */
  running?: boolean
  visible: boolean
}

export type PersonMode = 'calm' | 'flee' | 'grabbed' | 'gone'

export interface PersonState {
  pos: Vec3
  yaw: number
  mode: PersonMode
  /** walk/run animation speed driver */
  speed: number
}

export interface IncidentFrame {
  active: boolean
  t: number
  duration: number
  /** 0..1 white screen flash (lightning strike) */
  flash: number
  /** 0..1 camera shake intensity */
  shake: number
  outerGateBroken: boolean
  /** seconds since outer gate broke, -1 if intact (drives debris) */
  outerGateAge: number
  innerGateBroken: boolean
  innerGateAge: number
  colossal: TitanState | null
  /** 0..1 steam burst while the colossal dissolves */
  colossalSteam: number
  armored: TitanState | null
  pures: TitanState[]
  people: PersonState[]
  deaths: number
  caption: string | null
  endCard: boolean
}
