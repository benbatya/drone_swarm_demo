import { MapboxOverlay } from '@deck.gl/mapbox'
import { LineLayer } from '@deck.gl/layers'
import maplibregl, { type StyleSpecification } from 'maplibre-gl'
import { useEffect, useRef } from 'react'
import 'maplibre-gl/dist/maplibre-gl.css'
import { WORLD_CENTER } from '../../sim/config'
import type { TruthSnapshot } from '../../sim/snapshot'
import { useRunner } from '../RunnerContext'
import { useUIStore, type Tab } from '../store'
import { buildGraticule, type GridLine } from './graticule'
import { baseLayers, droneLayers, fireLayer } from './layers'

// Flat inline style so the app boots fully offline (no tile/glyph fetches).
// deck.gl generates its own text atlas, so no MapLibre glyphs are needed.
const FLAT_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#0b1220' } },
  ],
}

export function MapCanvas({ source }: { source: Tab }) {
  const runner = useRunner()
  const selectDrone = useUIStore((s) => s.selectDrone)
  const selectFire = useUIStore((s) => s.selectFire)
  const containerRef = useRef<HTMLDivElement>(null)
  const snapRef = useRef<TruthSnapshot>(runner.getStoreSnapshot())
  const sourceRef = useRef<Tab>(source)
  const rebuildRef = useRef<() => void>(() => {})

  // Keep the latest source without re-running the map-setup effect.
  sourceRef.current = source

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const map = new maplibregl.Map({
      container,
      style: FLAT_STYLE,
      center: [WORLD_CENTER.lng, WORLD_CENTER.lat],
      zoom: 5.4,
      attributionControl: false,
      dragRotate: false,
    })
    const overlay = new MapboxOverlay({ interleaved: true, layers: [] })
    map.addControl(overlay)

    const rebuild = () => {
      const b = map.getBounds()
      const grat = buildGraticule(
        { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() },
        map.getZoom(),
      )
      const snap = snapRef.current
      overlay.setProps({
        layers: [
          new LineLayer<GridLine>({
            id: 'graticule',
            data: grat,
            getSourcePosition: (d) => d.source,
            getTargetPosition: (d) => d.target,
            getColor: (d) => (d.major ? [92, 112, 148, 170] : [58, 72, 96, 110]),
            getWidth: 1,
            widthUnits: 'pixels',
          }),
          ...baseLayers(),
          ...fireLayer(snap.fires, selectFire),
          ...droneLayers(snap.drones, {
            showDetection: sourceRef.current === 'truth',
            detectionRadiusM: runner.cfg.detectionRadiusM,
            onSelect: selectDrone,
          }),
        ],
      })
    }
    rebuildRef.current = rebuild

    const onFrame = (s: TruthSnapshot) => {
      snapRef.current = s
      rebuild()
    }
    const unsub = runner.onFrame(onFrame)
    map.on('load', rebuild)
    map.on('move', rebuild)

    return () => {
      unsub()
      map.remove()
      rebuildRef.current = () => {}
    }
  }, [runner])

  // Reflect a tab switch (detection circles are God-Mode only) without
  // rebuilding the map.
  useEffect(() => {
    rebuildRef.current()
  }, [source])

  return (
    <div ref={containerRef} className="map-canvas" data-source={source} data-testid="map-canvas" />
  )
}
