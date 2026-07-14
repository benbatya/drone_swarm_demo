import { useSimSnapshot } from '../useSimSnapshot'
import { useUIStore } from '../store'
import { hsvToRgb, rgbCss } from '../map/colors'
import { ConfigPanel } from './ConfigPanel'
import { DronePanelTruth } from './DronePanelTruth'
import { FirePanel } from './FirePanel'
import { Row } from './bits'
import type { ReactNode } from 'react'

// God Mode side panel: ground-truth config, the full fleet list, and — when a
// drone or fire is selected — its detail below the list.
export function GodPanel() {
  const snap = useSimSnapshot()
  const selection = useUIStore((s) => s.selection)
  const selectDrone = useUIStore((s) => s.selectDrone)
  const clear = useUIStore((s) => s.clearSelection)

  const selDrone =
    selection?.kind === 'drone' ? snap.drones.find((x) => x.id === selection.id) : undefined
  const selFire =
    selection?.kind === 'fire' ? snap.fires.find((x) => x.cellId === selection.cellId) : undefined

  let detail: ReactNode
  if (selDrone) detail = <DronePanelTruth drone={selDrone} />
  else if (selFire) detail = <FirePanel fire={selFire} tick={snap.tick} />

  return (
    <div className="god-panel">
      <ConfigPanel />
      <hr className="sep" />
      <div className="panel">
        <div className="panel-head">
          <span className="panel-title">Fleet · {snap.drones.length}</span>
          {selection && (
            <button type="button" className="link" onClick={clear}>
              clear
            </button>
          )}
        </div>
        <div className="fleet-list">
          {snap.drones.map((d) => (
            <button
              key={d.id}
              type="button"
              className={'fleet-row' + (d.id === selDrone?.id ? ' selected' : '')}
              onClick={() => selectDrone(d.id)}
            >
              <span
                className="dot"
                style={{ background: rgbCss(hsvToRgb(d.hue, 1, d.status === 'crashed' ? 0.35 : 1)) }}
              />
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

      {detail && (
        <>
          <hr className="sep" />
          {detail}
        </>
      )}
    </div>
  )
}
