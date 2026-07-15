import { useEffect, useState } from 'react'
import type { ConsoleDroneView, ConsoleView, FireView } from '../../sim/snapshot'
import { useUIStore } from '../store'
import { useSimSnapshot } from '../useSimSnapshot'
import { hsvToRgb, rgbCss, staleValue } from '../map/colors'
import { DirectiveComposer } from './DirectiveComposer'
import { Row } from './bits'

const STALE_LABEL: Record<ConsoleDroneView['staleness'], string> = {
  fresh: 'fresh',
  stale: 'stale',
  missing: 'MISSING',
  unknown: 'no contact',
}

function ConsoleFleetList({
  cv,
  selectedId,
  onSelect,
}: {
  cv: ConsoleView
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  return (
    <div className="fleet-list">
      {cv.drones.map((d) => (
        <button
          key={d.id}
          type="button"
          className={'fleet-row' + (d.id === selectedId ? ' selected' : '')}
          onClick={() => onSelect(d.id)}
        >
          <span
            className="dot"
            style={{ background: rgbCss(hsvToRgb(d.hue, 1, staleValue(d.stalenessFrac))) }}
          />
          <span className="fl-id">{d.id}</span>
          <span className={'fl-mode stale-text-' + d.staleness}>
            {d.contactAgeMin == null ? '—' : `${d.contactAgeMin}m ago`}
          </span>
          <span className="fl-fuel">{STALE_LABEL[d.staleness]}</span>
        </button>
      ))}
    </div>
  )
}

function ConsoleDroneDetail({ d }: { d: ConsoleDroneView }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <span className="panel-title">{d.id}</span>
      </div>
      <Row
        k="Contact"
        v={
          d.contactAgeMin == null
            ? STALE_LABEL[d.staleness]
            : `${d.contactAgeMin}m ago · ${STALE_LABEL[d.staleness]}`
        }
        warn={d.staleness === 'missing' || d.staleness === 'stale'}
      />
      {d.reportedPosition && (
        <Row
          k="Last known"
          v={`${d.reportedPosition[1].toFixed(3)}, ${d.reportedPosition[0].toFixed(3)}`}
        />
      )}
      {d.status && <Row k="Reported status" v={d.status} />}
      {d.fuelL != null && <Row k="Reported fuel" v={`${Math.round(d.fuelL)} L`} />}
      {d.retardant != null && <Row k="Reported retardant" v={`${d.retardant}`} />}
      {d.extinguishedCount != null && (
        <Row k="Fires extinguished" v={`${d.extinguishedCount}`} />
      )}
      {d.forcedRtb && <Row k="Override" v="forced RTB" warn />}
      <Row
        k="Believed directive"
        v={d.currentDirectiveKind ? `${d.currentDirectiveKind} (+${d.queueLen})` : '—'}
      />
      <Row
        k="Pending"
        v={
          d.pendingCount === 0 ? '—' : `${d.downloadedCount}/${d.pendingCount} downloaded`
        }
      />
    </div>
  )
}

function ConsoleFireDetail({ f, tick }: { f: FireView; tick: number }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <span className="panel-title">Fire #{f.cellId}</span>
      </div>
      <Row k="Position" v={`${f.position[1].toFixed(3)}, ${f.position[0].toFixed(3)}`} />
      <Row k="First reported" v={`t = ${f.ignitedAt}`} />
      <Row k="Known for" v={`${Math.max(0, tick - f.ignitedAt).toLocaleString()} min`} />
    </div>
  )
}

export function ConsolePanel() {
  const snap = useSimSnapshot()
  const selection = useUIStore((s) => s.selection)
  const clear = useUIStore((s) => s.clearSelection)
  const selectDrone = useUIStore((s) => s.selectDrone)
  const cv = snap.console

  // The selected drone drives the state panel, the directive composer, and the
  // map's scan-region overlay. Persisted so it survives a fire-click (extinguish
  // targets a fire while keeping the same drone).
  const [targetId, setTargetId] = useState<string | null>(null)
  useEffect(() => {
    if (selection?.kind === 'drone') setTargetId(selection.id)
  }, [selection])

  const targetDrone = targetId ? cv.drones.find((x) => x.id === targetId) : undefined
  const fire =
    selection?.kind === 'fire' ? cv.fires.find((x) => x.cellId === selection.cellId) : undefined

  const knownFires = cv.fires.length
  const contactable = cv.drones.filter((d) => d.staleness === 'fresh').length

  const clearTarget = () => {
    setTargetId(null)
    clear()
  }

  return (
    <div className="console-panel">
      <div className="panel-head">
        <span className="panel-title">
          Console · {contactable}/{cv.drones.length} in contact
        </span>
        {targetId && (
          <button type="button" className="link" onClick={clearTarget}>
            clear
          </button>
        )}
      </div>
      <ConsoleFleetList cv={cv} selectedId={targetId} onSelect={selectDrone} />
      <div className="panel-stats">
        <Row k="Believed fires" v={`${knownFires}`} />
      </div>

      {targetDrone ? (
        <>
          <hr className="sep" />
          <ConsoleDroneDetail d={targetDrone} />
          <DirectiveComposer target={targetDrone.id} />
        </>
      ) : (
        <div className="hint">Select a drone to view its state and issue directives.</div>
      )}

      {fire && (
        <>
          <hr className="sep" />
          <ConsoleFireDetail f={fire} tick={snap.tick} />
        </>
      )}
    </div>
  )
}
