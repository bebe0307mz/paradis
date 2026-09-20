import { create } from 'zustand'
import type { Vec3 } from '../world/types'

export interface FlyTarget {
  /** where the orbit target should end up */
  target: Vec3
  /** where the camera should end up */
  position: Vec3
}

interface ParadisState {
  // ---- playback ----
  /** currently loaded incident id, or null when just exploring */
  incident: string | null
  playing: boolean
  /** playback clock in seconds — mutated every frame; components read via getState() in useFrame, HUD subscribes coarsely */
  t: number
  speed: number
  // ---- HUD-reactive incident facts (updated at low frequency by the driver) ----
  caption: string | null
  deaths: number
  endCard: boolean
  // ---- camera ----
  flyTo: FlyTarget | null
  /** bumped every time a fly is requested so the rig re-triggers */
  flySeq: number
  // ---- actions ----
  startIncident: (id: string) => void
  stopIncident: () => void
  setPlaying: (p: boolean) => void
  seek: (t: number) => void
  setSpeed: (s: number) => void
  setHud: (h: { caption: string | null; deaths: number; endCard: boolean }) => void
  requestFly: (f: FlyTarget) => void
}

export const useParadis = create<ParadisState>((set, get) => ({
  incident: null,
  playing: false,
  t: 0,
  speed: 1,
  caption: null,
  deaths: 0,
  endCard: false,
  flyTo: null,
  flySeq: 0,

  startIncident: (id) =>
    set({ incident: id, t: 0, playing: true, deaths: 0, caption: null, endCard: false }),
  stopIncident: () =>
    set({ incident: null, playing: false, t: 0, deaths: 0, caption: null, endCard: false }),
  setPlaying: (p) => set({ playing: p }),
  seek: (t) => set({ t, endCard: false }),
  setSpeed: (s) => set({ speed: s }),
  setHud: (h) => {
    const s = get()
    if (s.caption !== h.caption || s.deaths !== h.deaths || s.endCard !== h.endCard) set(h)
  },
  requestFly: (f) => set({ flyTo: f, flySeq: get().flySeq + 1 }),
}))

// debug/QA access from the browser console
declare global {
  interface Window {
    __paradis?: typeof useParadis
  }
}
if (typeof window !== 'undefined') window.__paradis = useParadis
