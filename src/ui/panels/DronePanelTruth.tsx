import type { DroneView } from '../../sim/snapshot'
import { BlackoutStrip } from './BlackoutStrip'
import { Bar, Row } from './bits'

export function DronePanelTruth({
  drone,
  onBack,
}: {
  drone: DroneView
  onBack?: () => void
}) {
  const fuelColor =
    drone.fuelFrac < 0.2 ? '#ff6a6a' : drone.fuelFrac < 0.4 ? '#ffb454' : '#5ce0a0'
  return (
    <div className="panel">
      <div className="panel-head">
        {onBack && (
          <button type="button" className="link" onClick={onBack}>
            ← fleet
          </button>
        )}
        <span className="panel-title">{drone.id}</span>
      </div>
      <Row k="Home" v={drone.homeBaseId} />
      <Row k="Status" v={drone.status} warn={drone.status === 'crashed'} />
      <Row k="Mode" v={drone.mode} />
      {(drone.mode === 'patrol' || drone.mode === 'scan') && (
        <>
          <Row k="Sweep" v={drone.scanOrientation} />
          <Row k="Scan" v={`${Math.round(drone.scanFrac * 100)}%`} />
        </>
      )}
      <Row
        k="Position"
        v={`${drone.position[1].toFixed(3)}, ${drone.position[0].toFixed(3)}`}
      />
      <Row k="Fuel" v={`${Math.round(drone.fuelL)} L · ${Math.round(drone.fuelFrac * 100)}%`} />
      <Bar frac={drone.fuelFrac} color={fuelColor} />
      <Row k="Retardant" v={`${drone.retardant} / 10`} />
      <Row k="Known fires" v={`${drone.knownCount}`} />
      <Row
        k="Queue"
        v={
          drone.queueLen === 0
            ? '—'
            : `${drone.queueLen}${drone.currentDirectiveKind ? ` · ${drone.currentDirectiveKind}` : ''}`
        }
      />
      {drone.forcedRtb && <Row k="Override" v="forced RTB" warn />}
      {drone.status === 'docked' && (
        <Row k="Turnaround" v={`${drone.dockRemainingMin} min left`} />
      )}
      {drone.crashedAt != null && <Row k="Crashed" v={`t = ${drone.crashedAt}`} warn />}
      <BlackoutStrip droneId={drone.id} />
    </div>
  )
}
