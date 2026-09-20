// Central per-frame evaluation. The current IncidentFrame lives in a module
// singleton — scene components read it inside useFrame (no React re-renders),
// while the HUD gets coarse reactive updates pushed into the zustand store.

import { useFrame } from '@react-three/fiber'
import { useParadis } from '../state/store'
import { evalEp1, EP1_DURATION } from './ep1'
import type { IncidentFrame } from '../world/types'

let current: IncidentFrame = evalEp1(0, false)

export function getFrame(): IncidentFrame {
  return current
}

export function IncidentDriver() {
  useFrame((_, delta) => {
    const s = useParadis.getState()
    let t = s.t
    if (s.incident && s.playing) {
      t = Math.min(EP1_DURATION, t + delta * s.speed)
      if (t !== s.t) useParadis.setState({ t })
      if (t >= EP1_DURATION && s.playing) useParadis.setState({ playing: false })
    }
    current = evalEp1(t, s.incident !== null)
    s.setHud({ caption: current.caption, deaths: current.deaths, endCard: current.endCard })
  })
  return null
}
