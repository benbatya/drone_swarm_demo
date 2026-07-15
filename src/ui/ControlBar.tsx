import { SPEED_MULTIPLIERS } from '../sim/config'
import { useRunner } from './RunnerContext'
import { useSimSnapshot } from './useSimSnapshot'

const SPEEDS = SPEED_MULTIPLIERS

export function ControlBar() {
  const runner = useRunner()
  const snap = useSimSnapshot()

  // Pause is exclusive with the speed settings: exactly one of Paused / ×N is
  // active. Picking a speed unpauses at that speed; Paused halts the sim.
  return (
    <div className="controlbar">
      <div className="speeds" role="group" aria-label="Playback speed">
        <button
          type="button"
          className={'ctrl' + (!snap.running ? ' active' : '')}
          onClick={() => runner.pause()}
          title="Pause"
          data-testid="speed-paused"
          aria-pressed={!snap.running}
        >
          Paused
        </button>
        {SPEEDS.map((s) => {
          const active = snap.running && snap.speed === s
          return (
            <button
              key={s}
              type="button"
              className={'ctrl' + (active ? ' active' : '')}
              onClick={() => runner.playAtSpeed(s)}
              data-testid={`speed-${s}`}
              aria-pressed={active}
            >
              ×{s}
            </button>
          )
        })}
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
