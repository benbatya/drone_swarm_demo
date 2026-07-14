import { useUIStore } from '../store'

// Bottom-right map control (below Terrain) to show every drone's scan zone at
// once, instead of only the selected drone's. Shared state → both tabs.
export function ScanZonesToggle() {
  const on = useUIStore((s) => s.showAllScans)
  const toggle = useUIStore((s) => s.toggleAllScans)
  return (
    <button
      type="button"
      className={'map-toggle' + (on ? ' active' : '')}
      onClick={toggle}
      title="Show all drone scan zones"
      data-testid="scan-zones-toggle"
      aria-pressed={on}
    >
      ▦ Scan zones
    </button>
  )
}
