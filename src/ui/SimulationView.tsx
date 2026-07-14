import { HillshadeToggle } from './map/HillshadeToggle'
import { MapCanvas } from './map/MapCanvas'
import { ScanZonesToggle } from './map/ScanZonesToggle'
import { ConsolePanel } from './panels/ConsolePanel'
import { GodPanel } from './panels/GodPanel'
import type { Tab } from './store'

// One view component, two tabs. `source` selects believed vs ground-truth data
// and the title. God Mode renders truth; the User Console renders the console's
// belief (staleness cues, dead-reckoned ghosts, missing) + directive composer.
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
          <div className="map-toggles">
            <HillshadeToggle />
            <ScanZonesToggle />
          </div>
        </div>
        <aside className="side-panel">
          {source === 'truth' ? <GodPanel /> : <ConsolePanel />}
        </aside>
      </div>
    </section>
  )
}
