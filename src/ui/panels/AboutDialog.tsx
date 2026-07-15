import { useEffect } from 'react'
import { useUIStore } from '../store'

// About dialog. Opens on load when the persisted "display by default" preference
// is on (see store.ts), and from the header "About" button. Dismissed via the
// close button, a backdrop click, or Escape. The "Display by default" toggle
// persists to localStorage for the next visit.
export function AboutDialog() {
  const showAbout = useUIStore((s) => s.showAbout)
  const setShowAbout = useUIStore((s) => s.setShowAbout)
  const aboutByDefault = useUIStore((s) => s.aboutByDefault)
  const setAboutByDefault = useUIStore((s) => s.setAboutByDefault)

  useEffect(() => {
    if (!showAbout) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowAbout(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showAbout, setShowAbout])

  if (!showAbout) return null

  return (
    <div
      className="about-overlay"
      onClick={() => setShowAbout(false)}
      role="dialog"
      aria-modal="true"
      aria-label="About Fire Season Drone Swarm C2"
    >
      <div className="about-card" onClick={(e) => e.stopPropagation()}>
        <div className="about-title">🔥 Fire Season — Drone Swarm C2</div>

        <p>
          A browser simulation of a 30-day forest-fire-fighting season in Northern
          California. Eight autonomous drones detect and extinguish
          randomly-igniting fires under an intent-based directive system, over an{' '}
          <strong>unreliable console↔drone comms link</strong>.
        </p>
        <p>
          The whole point is the gap between <strong>truth</strong> and{' '}
          <strong>belief</strong>: the console is a lens, never in the control
          loop, and it must never render stale data as if it were live.
        </p>
        <p>Two tabs share one map:</p>
        <ul>
          <li>
            <strong>User Console</strong> — only what the console has{' '}
            <em>heard</em> (successful syncs + operator input): last-known
            positions, dead-reckoned "ghosts", staleness cues, and drones gone
            MISSING during a blackout.
          </li>
          <li>
            <strong>God Mode</strong> — ground truth: real drone/fire state, comms
            blackout timelines, and the true score.
          </li>
        </ul>

        <div className="about-actions">
          <label className="about-default">
            <input
              type="checkbox"
              checked={aboutByDefault}
              onChange={(e) => setAboutByDefault(e.target.checked)}
            />
            Display by default
          </label>
          <button
            type="button"
            className="issue-btn"
            data-testid="about-close"
            onClick={() => setShowAbout(false)}
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  )
}
