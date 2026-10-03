import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { TileLayer, useMap } from 'react-leaflet'
import { OSM_ATTR, OSM_URL } from './mapIcon'

const MAX_ERRORS = 3

export default function OsmTiles() {
  const map = useMap()
  const [offline, setOffline] = useState(false)
  const errors = useRef(0)
  const handlers = useMemo(() => ({
    tileerror: () => { errors.current += 1; if (errors.current >= MAX_ERRORS) setOffline(true) },
    tileload: () => { errors.current = 0; setOffline(false) },
  }), [])
  useEffect(() => {
    const el = map.getContainer()
    el.classList.toggle('map-offline', offline)
    return () => el.classList.remove('map-offline')
  }, [map, offline])
  return (
    <>
      <TileLayer url={OSM_URL} attribution={OSM_ATTR} eventHandlers={handlers} />
      {offline && createPortal(
        <div className="map-offline-note" role="status">Map tiles offline. Markers and positions are still accurate.</div>,
        map.getContainer(),
      )}
    </>
  )
}
