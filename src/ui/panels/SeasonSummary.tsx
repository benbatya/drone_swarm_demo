import { useRunner } from '../RunnerContext'
import { useSimSnapshot } from '../useSimSnapshot'

// End-of-season card. Appears when the 30-day season completes; the score is
// total fire-minutes burned (lower is better).
export function SeasonSummary() {
  const snap = useSimSnapshot()
  const runner = useRunner()
  if (!snap.seasonComplete) return null

  const { totalFires, doused, fireMinutes } = snap.score
  const pct = totalFires > 0 ? Math.round((doused / totalFires) * 100) : 100

  return (
    <div className="summary-overlay">
      <div className="summary-card">
        <div className="summary-title">🔥 Season complete — 30 days</div>
        <div className="summary-score">
          {Math.round(fireMinutes).toLocaleString()}
          <span className="summary-unit"> fire-minutes burned</span>
        </div>
        <div className="summary-rows">
          <div>
            <span className="sr-k">Fires doused</span>
            <span className="sr-v">
              {doused.toLocaleString()} / {totalFires.toLocaleString()} ({pct}%)
            </span>
          </div>
          <div>
            <span className="sr-k">Still burning</span>
            <span className="sr-v">{snap.score.activeFires}</span>
          </div>
        </div>
        <button type="button" className="issue-btn" onClick={() => runner.restart()}>
          Run another season
        </button>
      </div>
    </div>
  )
}
