// Shared control bar (both tabs). M0 renders the layout with placeholders;
// M1 wires play/pause, speed, clock and score to the SimRunner.
const SPEEDS = [1, 4, 16, 60]

export function ControlBar() {
  return (
    <div className="controlbar">
      <button type="button" className="ctrl" disabled title="Play/pause (M1)">
        ⏸
      </button>
      <div className="speeds">
        {SPEEDS.map((s) => (
          <button key={s} type="button" className="ctrl" disabled>
            ×{s}
          </button>
        ))}
      </div>
      <div className="clock" data-testid="clock">
        Day 0 · 00:00
      </div>
      <div className="score" data-testid="score">
        — fire-min
      </div>
    </div>
  )
}
