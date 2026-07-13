import { useState } from 'react'
import { useRunner } from '../RunnerContext'

// God-Mode-only ground-truth controls. These are simulation parameters, so
// they never appear in the User Console (which can only observe consequences).
export function ConfigPanel() {
  const runner = useRunner()
  const [open, setOpen] = useState(false)
  const [seed, setSeed] = useState(runner.cfg.seed)
  const [firesPerHour, setFiresPerHour] = useState(
    Math.round(runner.cfg.ignitionLambdaPerMin * 60 * 10) / 10,
  )
  const [dronesPerBase, setDronesPerBase] = useState(runner.cfg.dronesPerBase)
  const [deepPct, setDeepPct] = useState(Math.round(runner.cfg.deepOutageProb * 100))

  const apply = () => {
    runner.applyConfig({
      seed,
      ignitionLambdaPerMin: firesPerHour / 60,
      dronesPerBase,
      deepOutageProb: deepPct / 100,
    })
  }

  return (
    <div className="config">
      <button
        type="button"
        className="config-toggle"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? '▾' : '▸'} Ground-truth config
      </button>
      {open && (
        <div className="config-body">
          <label className="field">
            <span>Seed</span>
            <input
              type="number"
              value={seed}
              onChange={(e) => setSeed(Number(e.target.value))}
            />
          </label>
          <label className="field">
            <span>Ignition rate (fires/hour): {firesPerHour}</span>
            <input
              type="range"
              min={0.2}
              max={8}
              step={0.2}
              value={firesPerHour}
              onChange={(e) => setFiresPerHour(Number(e.target.value))}
            />
          </label>
          <label className="field">
            <span>Drones per base: {dronesPerBase}</span>
            <input
              type="range"
              min={1}
              max={4}
              step={1}
              value={dronesPerBase}
              onChange={(e) => setDronesPerBase(Number(e.target.value))}
            />
          </label>
          <label className="field">
            <span>Deep-outage chance: {deepPct}%</span>
            <input
              type="range"
              min={0}
              max={20}
              step={1}
              value={deepPct}
              onChange={(e) => setDeepPct(Number(e.target.value))}
            />
          </label>
          <div className="config-actions">
            <button type="button" className="issue-btn" onClick={apply}>
              Apply &amp; restart
            </button>
            <button type="button" className="ctrl" onClick={() => runner.restart()}>
              Restart
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
