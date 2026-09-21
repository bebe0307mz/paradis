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
  soldiersLost: number
  titansSlain: number
  victory: boolean
  endCard: boolean
  /** director cam: scripted shots while an incident plays; any drag/wheel breaks out */
  cinematic: boolean
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
  setHud: (h: {
    caption: string | null
    deaths: number
    endCard: boolean
    soldiersLost: number
    titansSlain: number
    victory: boolean
  }) => void
  requestFly: (f: FlyTarget) => void
  setCinematic: (c: boolean) => void
}

export const useParadis = create<ParadisState>((set, get) => ({
  incident: null,
  playing: false,
  t: 0,
  speed: 1,
  caption: null,
  deaths: 0,
  soldiersLost: 0,
  titansSlain: 0,
  victory: false,
  endCard: false,
  cinematic: false,
  flyTo: null,
  flySeq: 0,

  startIncident: (id) =>
    set({
      incident: id,
      t: 0,
      playing: true,
      deaths: 0,
      soldiersLost: 0,
      titansSlain: 0,
      victory: false,
      caption: null,
      endCard: false,
      cinematic: true,
    }),
  stopIncident: () =>
    set({
      incident: null,
      playing: false,
      t: 0,
      deaths: 0,
      soldiersLost: 0,
      titansSlain: 0,
      victory: false,
      caption: null,
      endCard: false,
      cinematic: false,
    }),
  setPlaying: (p) => set({ playing: p }),
  seek: (t) => set({ t, endCard: false }),
  setSpeed: (s) => set({ speed: s }),
  setHud: (h) => {
    const s = get()
    if (
      s.caption !== h.caption ||
      s.deaths !== h.deaths ||
      s.endCard !== h.endCard ||
      s.soldiersLost !== h.soldiersLost ||
      s.titansSlain !== h.titansSlain ||
      s.victory !== h.victory
    )
      set(h)
  },
  requestFly: (f) => set({ flyTo: f, flySeq: get().flySeq + 1 }),
  setCinematic: (c) => set({ cinematic: c }),
}))

// debug/QA access from the browser console
declare global {
  interface Window {
    __paradis?: typeof useParadis
  }
}
if (typeof window !== 'undefined') window.__paradis = useParadis
