import { ControlBar } from './ControlBar'
import { SimulationView } from './SimulationView'
import { useUIStore, type Tab } from './store'

const TABS: { id: Tab; label: string }[] = [
  { id: 'console', label: 'User Console' },
  { id: 'truth', label: 'God Mode' },
]

export function App() {
  const activeTab = useUIStore((s) => s.activeTab)
  const setTab = useUIStore((s) => s.setTab)

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          🔥 Fire Season<span className="brand-sub">Drone Swarm C2</span>
        </div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              data-tab={t.id}
              className={'tab' + (activeTab === t.id ? ' active' : '')}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>
      <ControlBar />
      <main className="stage">
        <SimulationView source={activeTab} />
      </main>
    </div>
  )
}
