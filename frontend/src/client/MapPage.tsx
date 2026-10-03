import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { MapContainer, Marker, TileLayer, useMap } from 'react-leaflet'
import { getIncident, getIncidents } from '../api'
import type { IncidentMarker } from '../api'
import { usePoll } from '../hooks'
import { KRAKOW, OSM_ATTR, OSM_URL, severityIcon } from '../components/mapIcon'
import { LevelPill, Spinner } from '../components/ui'
import { CATEGORY_ICON, ago, catLabel, fmtTime } from '../labels'

function FlyTo({ target }: { target: IncidentMarker | null }) {
  const map = useMap()
  useEffect(() => {
    if (target) map.flyTo([target.latitude, target.longitude], Math.max(map.getZoom(), 15), { duration: 0.6 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.id])
  return null
}

function Sheet({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, error, loading } = usePoll(() => getIncident(id), 5000, id)
  return (
    <div className="sheet" role="dialog" aria-label="Incident details">
      <div className="sheet-grip" onClick={onClose} />
      <button className="sheet-x" onClick={onClose} aria-label="Close">✕</button>
      {loading && !data ? (
        <div className="center pad"><Spinner /></div>
      ) : error && !data ? (
        <div className="alert alert-bad"><strong>Could not load incident</strong><span>{(error as Error).message}</span></div>
      ) : data ? (
        <>
          <div className="sheet-head">
            <span className={`cat-badge sev-${data.max_severity ?? 'none'}`}>{data.category ? CATEGORY_ICON[data.category] : '•'}</span>
            <div>
              <h2>{catLabel(data.category)}</h2>
              <div className="muted small">
                {fmtTime(data.incident_time)} · {ago(data.incident_time)}
              </div>
            </div>
          </div>
          <div className="sheet-stats">
            <div className="stat-mini">
              <span className="stat-n">{data.published_count}</span>
              <span className="stat-l">{data.published_count === 1 ? 'report' : 'reports'}</span>
            </div>
            <div className="stat-mini">
              <LevelPill level={data.max_severity} />
              <span className="stat-l">max severity</span>
            </div>
          </div>
          <ul className="sheet-reports">
            {data.reports.map((r) => (
              <li key={r.id}>
                <div className="row-between">
                  <span className="muted small">{fmtTime(r.incident_time)}</span>
                  <span className="pills">
                    <LevelPill level={r.severity} label="Sev" />
                    <LevelPill level={r.urgency} label="Urg" />
                  </span>
                </div>
                <p>{r.description || <span className="muted">Photo only — no description</span>}</p>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  )
}

export default function MapPage() {
  const [params, setParams] = useSearchParams()
  const selected = params.get('incident')
  const { data, error } = usePoll(getIncidents, 5000)
  const [fly, setFly] = useState<IncidentMarker | null>(null)

  const markers = data ?? []
  const selectedMarker = useMemo(() => markers.find((m) => m.id === selected) ?? null, [markers, selected])

  // fly to an incident opened via ?incident= link once its marker is known
  useEffect(() => {
    if (selectedMarker && fly?.id !== selectedMarker.id) setFly(selectedMarker)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMarker?.id])

  const select = (id: string | null) => {
    if (id) setParams({ incident: id }, { replace: true })
    else setParams({}, { replace: true })
  }

  return (
    <div className="map-page">
      <div className="map-top">
        <div className="map-title">
          <strong>Incident map</strong>
          <span className="muted small">{data ? `${markers.length} active incident${markers.length === 1 ? '' : 's'}` : 'Loading…'}</span>
        </div>
        <div className="legend">
          <span><i className="lg lg-low" />Low</span>
          <span><i className="lg lg-medium" />Med</span>
          <span><i className="lg lg-high" />High</span>
        </div>
      </div>
      {error != null && <div className="map-err">Offline — showing last known incidents</div>}
      <MapContainer center={KRAKOW} zoom={13} className="map-full" zoomControl={false}>
        <TileLayer url={OSM_URL} attribution={OSM_ATTR} />
        {markers.map((m) => (
          <Marker
            key={m.id}
            position={[m.latitude, m.longitude]}
            icon={severityIcon(m.max_severity, m.published_count, m.id === selected)}
            eventHandlers={{ click: () => { select(m.id); setFly(m) } }}
          />
        ))}
        <FlyTo target={fly} />
      </MapContainer>
      {selected && <Sheet id={selected} onClose={() => select(null)} />}
    </div>
  )
}
