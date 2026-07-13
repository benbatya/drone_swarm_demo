import { useRunner } from '../RunnerContext'
import { useSimSnapshot } from '../useSimSnapshot'

const PAST_MIN = 60
const FUTURE_MIN = 180
const SPAN = PAST_MIN + FUTURE_MIN

// God-Mode blackout timeline for one drone: connected (green) vs dark, with
// routine (amber) and deep (red) outages visually distinguished. "Now" marker
// sits PAST_MIN in from the left.
export function BlackoutStrip({ droneId }: { droneId: string }) {
  useSimSnapshot() // re-render as the sim advances
  const runner = useRunner()
  const bo = runner.getBlackout(droneId)
  if (!bo) return null

  const start = bo.now - PAST_MIN
  const end = bo.now + FUTURE_MIN
  const pct = (t: number) => ((t - start) / SPAN) * 100

  const segs = bo.windows
    .filter((w) => w.endMin > start && w.startMin < end)
    .map((w, i) => {
      const left = Math.max(0, pct(w.startMin))
      const right = Math.min(100, pct(w.endMin))
      return { i, left, width: Math.max(0.5, right - left), deep: w.deep }
    })

  return (
    <div className="blackout">
      <div className="blackout-label">Comms timeline</div>
      <div className="strip">
        {segs.map((s) => (
          <div
            key={s.i}
            className={'strip-seg' + (s.deep ? ' deep' : ' routine')}
            style={{ left: `${s.left}%`, width: `${s.width}%` }}
          />
        ))}
        <div className="strip-now" style={{ left: `${pct(bo.now)}%` }} />
      </div>
      <div className="strip-legend">
        <span className="lg connected">connected</span>
        <span className="lg routine">routine</span>
        <span className="lg deep">deep outage</span>
      </div>
    </div>
  )
}
