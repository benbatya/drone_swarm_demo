import type { ConsoleDroneView, ConsoleView, FireView } from '../../sim/snapshot'
import { useUIStore } from '../store'
import { useSimSnapshot } from '../useSimSnapshot'
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
  onSelect,
}: {
  cv: ConsoleView
  onSelect: (id: string) => void
}) {
  return (
    <div className="fleet-list">
      {cv.drones.map((d) => (
        <button
          key={d.id}
          type="button"
          className="fleet-row"
          onClick={() => onSelect(d.id)}
        >
          <span className={`dot stale-${d.staleness}`} />
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

function ConsoleDroneDetail({
  d,
  onBack,
}: {
  d: ConsoleDroneView
  onBack: () => void
}) {
  return (
    <div className="panel">
      <div className="panel-head">
        <button type="button" className="link" onClick={onBack}>
          ← fleet
        </button>
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
      {d.forcedRtb && <Row k="Override" v="forced RTB" warn />}
      <Row
        k="Believed directive"
        v={d.currentDirectiveKind ? `${d.currentDirectiveKind} (+${d.queueLen})` : '—'}
      />
      <Row
        k="Pending"
        v={
          d.pendingCount === 0
            ? '—'
            : `${d.downloadedCount}/${d.pendingCount} downloaded`
        }
      />
    </div>
  )
}

function ConsoleFireDetail({
  f,
  tick,
  onBack,
}: {
  f: FireView
  tick: number
  onBack: () => void
}) {
  return (
    <div className="panel">
      <div className="panel-head">
        <button type="button" className="link" onClick={onBack}>
          ← fleet
        </button>
        <span className="panel-title">Fire #{f.cellId}</span>
      </div>
      <Row
        k="Position"
        v={`${f.position[1].toFixed(3)}, ${f.position[0].toFixed(3)}`}
      />
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

  let detail
  if (selection?.kind === 'drone') {
    const d = cv.drones.find((x) => x.id === selection.id)
    if (d) detail = <ConsoleDroneDetail d={d} onBack={clear} />
  } else if (selection?.kind === 'fire') {
    const f = cv.fires.find((x) => x.cellId === selection.cellId)
    if (f) detail = <ConsoleFireDetail f={f} tick={snap.tick} onBack={clear} />
  }

  const knownFires = cv.fires.length
  const contactable = cv.drones.filter((d) => d.staleness === 'fresh').length

  return (
    <div className="console-panel">
      <DirectiveComposer />
      <hr className="sep" />
      {detail ?? (
        <>
          <div className="panel-title">
            Console · {contactable}/{cv.drones.length} in contact
          </div>
          <ConsoleFleetList cv={cv} onSelect={selectDrone} />
          <div className="panel-stats">
            <Row k="Believed fires" v={`${knownFires}`} />
          </div>
        </>
      )}
    </div>
  )
}
