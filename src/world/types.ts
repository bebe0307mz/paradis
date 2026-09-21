export type Vec3 = [number, number, number]

export type TitanKind = 'colossal' | 'armored' | 'pure' | 'rogue'

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
  /** 0 standing → 1 flat on the ground (nape-killed / punched down) */
  down: number
  /** 0..1 per-titan steam dissolve after death (separate from colossalSteam) */
  steam: number
  /** 0..1 punch/slam cycle (rogue fistfight, boulder slam) */
  attack: number
  /** 0..1 carrying the boulder overhead (rogue gait slows, arms up) */
  carry: number
  visible: boolean
}

export type SoldierMode = 'zip' | 'stand' | 'dead' | 'gone'

export interface SoldierState {
  pos: Vec3
  yaw: number
  mode: SoldierMode
  /** cable attach point while zipping; anchor[1] < 0 means no cable drawn */
  anchor: Vec3
  /** animation speed driver */
  speed: number
}

export interface BoulderState {
  pos: Vec3
  /** overhead in the rogue's hands */
  held: boolean
  /** slammed into the breach */
  sealed: boolean
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
  /** which incident this frame belongs to — gates gore/fires/breakables per episode */
  id: string | null
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
  /** 0..1 how far the scene has descended into hell — drives sky/fog/light grading */
  atmosphere: number
  armored: TitanState | null
  rogue: TitanState | null
  pures: TitanState[]
  people: PersonState[]
  soldiers: SoldierState[]
  boulder: BoulderState | null
  deaths: number
  soldiersLost: number
  titansSlain: number
  caption: string | null
  endCard: boolean
  /** the end card celebrates instead of mourns (Trost) */
  victory: boolean
}
