// Central per-frame evaluation. The current IncidentFrame lives in a module
// singleton — scene components read it inside useFrame (no React re-renders),
// while the HUD gets coarse reactive updates pushed into the zustand store.

import { useFrame } from '@react-three/fiber'
import { useParadis } from '../state/store'
import { evalEp1, EP1_DURATION } from './ep1'
import { evalEp2, EP2_DURATION } from './ep2'
import type { IncidentFrame } from '../world/types'

const EPISODES: Record<string, { evalFn: (t: number, active: boolean) => IncidentFrame; duration: number }> = {
  ep1: { evalFn: evalEp1, duration: EP1_DURATION },
  ep2: { evalFn: evalEp2, duration: EP2_DURATION },
}

export function incidentDuration(id: string): number {
  return EPISODES[id]?.duration ?? EP1_DURATION
}

let current: IncidentFrame = evalEp1(0, false)

export function getFrame(): IncidentFrame {
  return current
}

export function IncidentDriver() {
  useFrame((_, delta) => {
    const s = useParadis.getState()
    const ep = EPISODES[s.incident ?? 'ep1'] ?? EPISODES.ep1
    let t = s.t
    if (s.incident && s.playing) {
      t = Math.min(ep.duration, t + delta * s.speed)
      if (t !== s.t) useParadis.setState({ t })
      if (t >= ep.duration && s.playing) useParadis.setState({ playing: false })
    }
    current = ep.evalFn(t, s.incident !== null)
    s.setHud({
      caption: current.caption,
      deaths: current.deaths,
      endCard: current.endCard,
      soldiersLost: current.soldiersLost,
      titansSlain: current.titansSlain,
      victory: current.victory,
    })
  })
  return null
}
