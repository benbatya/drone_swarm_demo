import type { FireView } from '../../sim/snapshot'
import { Row } from './bits'

export function FirePanel({
  fire,
  tick,
  onBack,
}: {
  fire: FireView
  tick: number
  onBack: () => void
}) {
  const alightMin = Math.max(0, tick - fire.ignitedAt)
  return (
    <div className="panel">
      <div className="panel-head">
        <button type="button" className="link" onClick={onBack}>
          ← fleet
        </button>
        <span className="panel-title">Fire #{fire.cellId}</span>
      </div>
      <Row
        k="Position"
        v={`${fire.position[1].toFixed(3)}, ${fire.position[0].toFixed(3)}`}
      />
      <Row k="Ignited" v={`t = ${fire.ignitedAt}`} />
      <Row k="Alight" v={`${alightMin.toLocaleString()} min`} warn />
    </div>
  )
}
