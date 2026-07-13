import { SPEED_MULTIPLIERS } from '../sim/config'
import { useRunner } from './RunnerContext'
import { useSimSnapshot } from './useSimSnapshot'

const SPEEDS = SPEED_MULTIPLIERS

export function ControlBar() {
  const runner = useRunner()
  const snap = useSimSnapshot()

  return (
    <div className="controlbar">
      <button
        type="button"
        className="ctrl"
        onClick={() => runner.toggle()}
        title="Play / pause"
        data-testid="play-pause"
      >
        {snap.running ? '⏸' : '▶'}
      </button>
      <div className="speeds">
        {SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            className={'ctrl' + (snap.speed === s ? ' active' : '')}
            onClick={() => runner.setSpeed(s)}
            data-testid={`speed-${s}`}
          >
            ×{s}
          </button>
        ))}
      </div>
      <div className="clock" data-testid="clock">
        Day {snap.day} · {snap.hourMin}
      </div>
      <div className="score" data-testid="score" title="Total fire-minutes burned (ground truth)">
        {Math.round(snap.score.fireMinutes).toLocaleString()} fire-min ·{' '}
        {snap.score.activeFires} active
      </div>
    </div>
  )
}
