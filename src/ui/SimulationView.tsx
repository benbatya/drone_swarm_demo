import { MapCanvas } from './map/MapCanvas'
import { GodPanel } from './panels/GodPanel'
import type { Tab } from './store'

// One view component, two tabs. `source` selects believed vs ground-truth data
// and the title. God Mode gets the truth side panel; the User Console panel
// (belief + directive composer) arrives in M3.
export function SimulationView({ source }: { source: Tab }) {
  const title =
    source === 'truth'
      ? 'God Mode — Ground Truth'
      : 'User Console — Believed State'
  return (
    <section className="sim-view" data-source={source}>
      <div className="sim-body">
        <div className="map-wrap">
          <div className="view-title" data-testid="view-title">
            {title}
          </div>
          <MapCanvas source={source} />
        </div>
        <aside className="side-panel">
          {source === 'truth' ? (
            <GodPanel />
          ) : (
            <div className="panel">
              <div className="panel-title">User Console</div>
              <p className="muted">
                Belief-based console view (staleness cues, dead reckoning,
                directive composer) arrives in M3. This tab currently mirrors
                ground truth.
              </p>
            </div>
          )}
        </aside>
      </div>
    </section>
  )
}
