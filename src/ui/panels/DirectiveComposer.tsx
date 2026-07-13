import { useEffect, useState } from 'react'
import { BASES } from '../../sim/config'
import { lngLatToMeters } from '../../sim/geo'
import type { Directive, RectM } from '../../sim/directives/types'
import { useRunner } from '../RunnerContext'
import { useUIStore, type DraftRect } from '../store'
import { useSimSnapshot } from '../useSimSnapshot'

let idSeq = 0
const nextId = () => `op-${++idSeq}`

function draftToRectM(r: DraftRect): RectM {
  const a = lngLatToMeters(r.west, r.south)
  const b = lngLatToMeters(r.east, r.north)
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  }
}

type Kind = 'scan' | 'extinguish' | 'rtb'

export function DirectiveComposer() {
  const runner = useRunner()
  const snap = useSimSnapshot()
  const selection = useUIStore((s) => s.selection)
  const draftRect = useUIStore((s) => s.draftRect)
  const setDraftRect = useUIStore((s) => s.setDraftRect)

  const [target, setTarget] = useState(snap.console.drones[0]?.id ?? '')
  const [kind, setKind] = useState<Kind>('scan')
  const [importance, setImportance] = useState(5)
  const [durationMin, setDurationMin] = useState(240)
  const [baseId, setBaseId] = useState(BASES[0].id)

  useEffect(() => {
    if (selection?.kind === 'drone') setTarget(selection.id)
  }, [selection])

  const fireCell = selection?.kind === 'fire' ? selection.cellId : null
  const canIssue =
    !!target &&
    (kind === 'scan' ? !!draftRect : kind === 'extinguish' ? fireCell != null : true)

  const issue = () => {
    if (!canIssue) return
    const base = { id: nextId(), importance, issuedAt: 0 }
    let dir: Directive
    if (kind === 'scan') {
      dir = { kind: 'scan', ...base, rect: draftToRectM(draftRect!), durationMin }
      setDraftRect(null)
    } else if (kind === 'extinguish') {
      dir = { kind: 'extinguish', ...base, cellId: fireCell! }
    } else {
      dir = { kind: 'rtb', ...base, baseId }
    }
    runner.issueDirective(target, dir)
  }

  return (
    <div className="composer">
      <div className="panel-title">Issue directive</div>
      <label className="field">
        <span>Drone</span>
        <select value={target} onChange={(e) => setTarget(e.target.value)}>
          {snap.console.drones.map((d) => (
            <option key={d.id} value={d.id}>
              {d.id}
            </option>
          ))}
        </select>
      </label>

      <div className="seg">
        {(['scan', 'extinguish', 'rtb'] as Kind[]).map((k) => (
          <button
            key={k}
            type="button"
            className={'seg-btn' + (kind === k ? ' active' : '')}
            onClick={() => setKind(k)}
          >
            {k}
          </button>
        ))}
      </div>

      {kind === 'scan' && (
        <>
          <div className={'hint' + (draftRect ? ' ok' : '')}>
            {draftRect ? 'Scan area captured ✓' : 'Shift-drag on the map to set the scan area'}
          </div>
          <label className="field">
            <span>Duration (min)</span>
            <input
              type="number"
              min={30}
              step={30}
              value={durationMin}
              onChange={(e) => setDurationMin(Number(e.target.value))}
            />
          </label>
        </>
      )}

      {kind === 'extinguish' && (
        <div className={'hint' + (fireCell != null ? ' ok' : '')}>
          {fireCell != null ? `Target: fire #${fireCell}` : 'Click a fire on the map'}
        </div>
      )}

      {kind === 'rtb' && (
        <label className="field">
          <span>Base</span>
          <select value={baseId} onChange={(e) => setBaseId(e.target.value)}>
            {BASES.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="field">
        <span>Importance {importance}</span>
        <input
          type="range"
          min={1}
          max={10}
          value={importance}
          onChange={(e) => setImportance(Number(e.target.value))}
        />
      </label>

      <button type="button" className="issue-btn" disabled={!canIssue} onClick={issue}>
        Issue directive
      </button>
    </div>
  )
}
