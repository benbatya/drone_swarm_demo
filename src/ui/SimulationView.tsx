import { MapCanvas } from './map/MapCanvas'
import type { Tab } from './store'

// One view component, two tabs. `source` selects believed vs ground-truth data
// (identical in M0 — bases + grid only) and the title.
export function SimulationView({ source }: { source: Tab }) {
  const title =
    source === 'truth'
      ? 'God Mode — Ground Truth'
      : 'User Console — Believed State'
  return (
    <section className="sim-view" data-source={source}>
      <div className="view-title" data-testid="view-title">
        {title}
      </div>
      <MapCanvas source={source} />
    </section>
  )
}
