import { useSimSnapshot } from '../useSimSnapshot'
import { useUIStore } from '../store'
import { DronePanelTruth } from './DronePanelTruth'
import { FirePanel } from './FirePanel'
import { Row } from './bits'

// God Mode side panel: fleet summary, or the detail of a selected drone/fire.
export function GodPanel() {
  const snap = useSimSnapshot()
  const selection = useUIStore((s) => s.selection)
  const selectDrone = useUIStore((s) => s.selectDrone)
  const clear = useUIStore((s) => s.clearSelection)

  if (selection?.kind === 'drone') {
    const d = snap.drones.find((x) => x.id === selection.id)
    if (d) return <DronePanelTruth drone={d} onBack={clear} />
  }
  if (selection?.kind === 'fire') {
    const f = snap.fires.find((x) => x.cellId === selection.cellId)
    if (f) return <FirePanel fire={f} tick={snap.tick} onBack={clear} />
  }

  return (
    <div className="panel">
      <div className="panel-title">Fleet · {snap.drones.length}</div>
      <div className="fleet-list">
        {snap.drones.map((d) => (
          <button
            key={d.id}
            type="button"
            className="fleet-row"
            onClick={() => selectDrone(d.id)}
          >
            <span className={`dot ${d.status}`} />
            <span className="fl-id">{d.id}</span>
            <span className="fl-mode">{d.mode}</span>
            <span className="fl-fuel">{Math.round(d.fuelFrac * 100)}%</span>
          </button>
        ))}
      </div>
      <div className="panel-stats">
        <Row k="Active fires" v={`${snap.score.activeFires}`} />
        <Row k="Doused" v={`${snap.score.doused}`} />
        <Row k="Total ignitions" v={`${snap.score.totalFires}`} />
        <Row k="Fire-minutes" v={Math.round(snap.score.fireMinutes).toLocaleString()} />
      </div>
    </div>
  )
}
