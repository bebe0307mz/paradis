import { useEffect, useRef, useState } from 'react'
import { useParadis } from '../state/store'
import { EP1_DURATION, EP1_META, EP1_AFTERMATH } from '../incidents/ep1'
import './hud.css'

// ---------------------------------------------------------------------------
// share intent — Wall Maria fall, no long dashes in the copy
// ---------------------------------------------------------------------------
const SHARE_TEXT =
  'I just watched Wall Maria fall. Real scale, a 60 m Colossal Titan against a 50 m wall, 850 people in the streets. In the browser.\n\nhttps://paradis-sepia.vercel.app'
const SHARE_URL = `https://twitter.com/intent/tweet?text=${encodeURIComponent(SHARE_TEXT)}`

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------
function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${r.toString().padStart(2, '0')}`
}

const LOCKED = [
  'Episode 2 — The Battle of Trost',
  'Episode 3 — The Female Titan · Stohess',
  'Episode 4 — Return to Shiganshina',
]

// ---------------------------------------------------------------------------
// wordmark (top-left)
// ---------------------------------------------------------------------------
function Wordmark() {
  return (
    <div className="hud-wordmark">
      <h1 className="hud-title">PARADIS</h1>
      <p className="hud-subtitle">Survey Corps field record · Year 845</p>
      <p className="hud-tagline">Explore the walls. Open an incident to watch it burn.</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// episodes panel (bottom-left)
// ---------------------------------------------------------------------------
function EpisodesPanel() {
  const [open, setOpen] = useState(true)
  const incident = useParadis((s) => s.incident)
  const startIncident = useParadis((s) => s.startIncident)
  const requestFly = useParadis((s) => s.requestFly)

  const playEp1 = () => {
    startIncident('ep1')
    requestFly({ target: [0, 45, 12480], position: [390, 230, 13230] })
  }

  return (
    <div className="hud-panel hud-episodes">
      <div className="hud-panel-header">
        <button
          className="hud-panel-headbtn"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <span className="hud-panel-label">Casualty Report · Incidents</span>
          <span className="hud-panel-toggle">{open ? '–' : '+'}</span>
        </button>
        <a
          className="hud-share-icon"
          href={SHARE_URL}
          target="_blank"
          rel="noopener"
          aria-label="Post on X"
          title="Post on X"
        >
          𝕏
        </a>
      </div>
      {open && (
        <ul className="hud-ep-list">
          <li>
            <button
              className={`hud-ep hud-ep-playable${incident === 'ep1' ? ' hud-ep-active' : ''}`}
              onClick={playEp1}
            >
              <span className="hud-ep-no">Episode 1</span>
              <span className="hud-ep-name">{EP1_META.title}</span>
              <span className="hud-ep-meta">Year {EP1_META.year} · playable</span>
            </button>
          </li>
          {LOCKED.map((label) => {
            const [no, name] = label.split(' — ')
            return (
              <li key={label}>
                <div className="hud-ep hud-ep-locked" aria-disabled="true">
                  <span className="hud-ep-no">{no}</span>
                  <span className="hud-ep-name">{name}</span>
                  <span className="hud-ep-soon">SEALED</span>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// scrubber — isolated so the 60fps `t` subscription does not re-render the HUD
// ---------------------------------------------------------------------------
function Scrubber() {
  const t = useParadis((s) => s.t)
  const seek = useParadis((s) => s.seek)
  return (
    <div className="hud-scrub-row">
      <span className="hud-time">
        {fmtTime(t)} / {fmtTime(EP1_DURATION)}
      </span>
      <input
        className="hud-scrub"
        type="range"
        min={0}
        max={EP1_DURATION}
        step={0.1}
        value={Math.min(t, EP1_DURATION)}
        onInput={(e) => seek(+(e.target as HTMLInputElement).value)}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// playback bar (bottom-center) — only while an incident is loaded
// ---------------------------------------------------------------------------
function PlaybackBar() {
  const incident = useParadis((s) => s.incident)
  const playing = useParadis((s) => s.playing)
  const speed = useParadis((s) => s.speed)
  const cinematic = useParadis((s) => s.cinematic)
  const setPlaying = useParadis((s) => s.setPlaying)
  const setSpeed = useParadis((s) => s.setSpeed)
  const setCinematic = useParadis((s) => s.setCinematic)
  const stopIncident = useParadis((s) => s.stopIncident)
  const requestFly = useParadis((s) => s.requestFly)

  if (incident === null) return null

  const cycleSpeed = () => {
    setSpeed(speed === 0.5 ? 1 : speed === 1 ? 2 : 0.5)
  }
  const exit = () => {
    stopIncident()
    requestFly({ target: [0, 0, 2000], position: [0, 10000, 24000] })
  }

  return (
    <div className="hud-playback">
      <button
        className="hud-btn hud-btn-icon"
        onClick={() => setPlaying(!playing)}
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {playing ? '▮▮' : '▶'}
      </button>
      <Scrubber />
      <button className="hud-btn hud-btn-speed" onClick={cycleSpeed} aria-label="Playback speed">
        {speed}×
      </button>
      <button
        className={`hud-btn hud-btn-director${cinematic ? ' hud-btn-director-on' : ''}`}
        onClick={() => setCinematic(!cinematic)}
        aria-pressed={cinematic}
        aria-label="Director camera"
      >
        DIRECTOR
      </button>
      <button className="hud-btn hud-btn-icon hud-btn-exit" onClick={exit} aria-label="Exit incident">
        ✕
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// caption band (just above the playback bar)
// ---------------------------------------------------------------------------
function CaptionBar() {
  const caption = useParadis((s) => s.caption)
  return (
    <div className={`hud-caption${caption ? ' hud-caption-on' : ''}`}>
      <span className="hud-caption-text">{caption ?? ''}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// cinematic letterbox — black bars while the director cam runs an incident
// ---------------------------------------------------------------------------
function Letterbox() {
  const cinematic = useParadis((s) => s.cinematic)
  const incident = useParadis((s) => s.incident)
  const endCard = useParadis((s) => s.endCard)
  const on = cinematic && incident !== null && !endCard
  return (
    <div className={`hud-letterbox${on ? ' hud-letterbox-on' : ''}`} aria-hidden="true">
      <div className="hud-letterbox-bar hud-letterbox-top" />
      <div className="hud-letterbox-bar hud-letterbox-bottom" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// casualties counter (top-right) — only when active and deaths > 0
// ---------------------------------------------------------------------------
function Casualties() {
  const incident = useParadis((s) => s.incident)
  const deaths = useParadis((s) => s.deaths)
  const prev = useRef(deaths)
  const [pulse, setPulse] = useState(false)

  useEffect(() => {
    if (deaths !== prev.current) {
      prev.current = deaths
      setPulse(true)
      const id = setTimeout(() => setPulse(false), 260)
      return () => clearTimeout(id)
    }
  }, [deaths])

  if (incident === null || deaths <= 0) return null
  return (
    <div className="hud-casualties">
      <span className="hud-casualties-label">Confirmed Eaten</span>
      <span className={`hud-casualties-count${pulse ? ' hud-casualties-pulse' : ''}`}>
        {deaths}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// end card — memorial / aftermath, appears when endCard is true
// ---------------------------------------------------------------------------
function EndCard() {
  const endCard = useParadis((s) => s.endCard)
  const deaths = useParadis((s) => s.deaths)
  const seek = useParadis((s) => s.seek)
  const setPlaying = useParadis((s) => s.setPlaying)

  const replay = () => {
    seek(0)
    setPlaying(true)
  }
  const explore = () => {
    setPlaying(false)
    seek(71.9)
  }

  return (
    <div className={`hud-endcard${endCard ? ' hud-endcard-on' : ''}`} aria-hidden={!endCard}>
      <div className="hud-endcard-inner">
        <p className="hud-endcard-kicker">Year 845 · Casualty Report</p>
        <h2 className="hud-endcard-title">WALL MARIA HAS FALLEN</h2>
        <p className="hud-endcard-toll">
          Confirmed eaten on this record <span>{deaths}</span>
        </p>
        <ul className="hud-endcard-stats">
          {EP1_AFTERMATH.map((line) => (
            <li key={line} className="hud-endcard-stat">
              {line}
            </li>
          ))}
        </ul>
        <div className="hud-endcard-actions">
          <button className="hud-btn hud-btn-wide" onClick={replay}>
            REPLAY
          </button>
          <button className="hud-btn hud-btn-wide" onClick={explore}>
            EXPLORE THE RUINS
          </button>
          <a
            className="hud-btn hud-btn-wide hud-btn-share"
            href={SHARE_URL}
            target="_blank"
            rel="noopener"
          >
            POST ON 𝕏
          </a>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// footnote (bottom-right)
// ---------------------------------------------------------------------------
function Footnote() {
  return (
    <div className="hud-footnote">
      <p>True vertical scale · walls 50 m, Colossal Titan 60 m · overland distances compressed 40:1</p>
      <p>Drag to orbit · scroll to zoom · right-drag to pan</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// root
// ---------------------------------------------------------------------------
export function HUD() {
  return (
    <div className="hud-root">
      <Letterbox />
      <Wordmark />
      <Casualties />
      <EpisodesPanel />
      <CaptionBar />
      <PlaybackBar />
      <Footnote />
      <EndCard />
    </div>
  )
}
