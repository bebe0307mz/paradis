# PARADIS

An explorable 3D Attack on Titan world — the walled island of Paradis, rendered
at true vertical scale in the browser. No AI agents, no game loop: a living map
where historical incidents are pinned in place, and clicking one plays the event
back as a deterministic, scrubbable timeline seen from god's perspective.

**Episode 1 — The Fall of Shiganshina (Year 845)** is playable: the lightning
flash, the Colossal Titan over the outer gate, the kick, the breach, pure titans
pouring into the streets, civilians fleeing for the inner gate (not all of them
make it), the Colossal dissolving into steam, and the Armored Titan's charge
that ends Wall Maria.

## Scale doctrine

1 unit = 1 meter. Everything vertical is true to canon: walls 50 m, Colossal
Titan 60 m, Armored 15 m, pure titans 5–15 m, houses 5–9 m, people 1.7 m.
District footprints are true (~1.1 km walled semicircles). Only the empty
countryside between the walls is compressed ~40:1 (canon radii 250/380/480 km)
so the whole island fits one seamless, float-safe scene — god view to street
level is a single camera move.

## Architecture

- `src/incidents/ep1.ts` — the whole episode is a **pure function of time t**.
  All randomness is seeded at module init, so seeking/scrubbing is exact:
  titan paths, 320 civilians' flee paths, and every victim's grab moment are
  deterministic keyframes evaluated per frame with zero allocation.
- `src/incidents/driver.ts` — evaluates the frame singleton once per rAF;
  scene components read it in `useFrame` (no React re-renders), the HUD gets
  coarse reactive updates via zustand.
- `src/scene/` — procedural everything: extruded ring walls with breakable
  gates + precomputed ballistic debris, instanced towns (~3,500 buildings),
  instanced crowd, articulated titan rigs (walk/eat/kick/charge cycles).

## Run

```
npm install
npm run dev
```

Built with Vite + React + three.js (@react-three/fiber). Fan work, no assets
from the show — everything is procedural geometry.
