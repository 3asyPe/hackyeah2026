import { Link, useParams } from 'react-router-dom'
import { op } from '../api'
import type { Status } from '../api'
import { useOpPoll } from './ctx'
import { ErrorBox, FinalLine, SimulationNote, Spinner, StatusChip } from '../components/ui'
import { CATEGORY_ICON, INCIDENT_STATE_LABEL, ago, catLabel, fmtCoord, fmtTime, humanize, shortId } from '../labels'
import { useNow } from '../hooks'

const ORDER: Status[] = ['critical', 'in_review', 'failed', 'processing', 'published', 'rejected']

export default function IncidentDetailPage() {
  useNow()
  const { id = '' } = useParams()
  const { data: inc, error, loading } = useOpPoll(() => op.incident(id), `incident-${id}`)

  if (loading && !inc) return <div className="op-page pad center"><Spinner /></div>
  if (!inc) return <div className="op-page"><ErrorBox error={error} title="Could not load incident" /></div>

  const reports = [...inc.reports].sort(
    (a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || +new Date(b.submitted_at) - +new Date(a.submitted_at),
  )
  const byStatus = reports.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1
    return acc
  }, {})

  return (
    <div className="op-page">
      <header className="op-head">
        <div>
          <div className="eyebrow"><Link to="/operator">← Overview</Link></div>
          <h1>
            <span className="cat-ico">{inc.category ? CATEGORY_ICON[inc.category] : '•'}</span> {catLabel(inc.category)}
          </h1>
          <div className="muted small mono">Incident {inc.id}</div>
        </div>
        <div className="head-right">
          <span className={`chip chip-state-${inc.state}`}>{INCIDENT_STATE_LABEL[inc.state] ?? inc.state}</span>
          {inc.merged_into_id && (
            <Link className="btn btn-secondary btn-sm" to={`/operator/incidents/${inc.merged_into_id}`}>
              Merged into {shortId(inc.merged_into_id)} →
            </Link>
          )}
        </div>
      </header>
      {error != null && <div className="hint hint-warn">Live update failed — showing last data.</div>}

      <div className="counters counters-sm">
        <div className="counter counter-neutral has"><span className="counter-n">{inc.report_count}</span><span className="counter-l">Linked reports</span></div>
        <div className="counter counter-published has"><span className="counter-n">{inc.published_count}</span><span className="counter-l">Published (on map)</span></div>
        <div className={`counter counter-critical ${inc.critical_count ? 'has' : ''}`}><span className="counter-n">{inc.critical_count}</span><span className="counter-l">Critical</span></div>
        <div className="counter counter-neutral">
          <span className="counter-n counter-n-sm">{fmtTime(inc.incident_time)}</span>
          <span className="counter-l">Anchor time · {ago(inc.incident_time)}</span>
        </div>
        <div className="counter counter-neutral">
          <span className="counter-n counter-n-sm mono">{fmtCoord(inc.latitude, inc.longitude)}</span>
          <span className="counter-l">
            Anchor location ·{' '}
            <a href={`https://www.openstreetmap.org/?mlat=${inc.latitude}&mlon=${inc.longitude}#map=17/${inc.latitude}/${inc.longitude}`} target="_blank" rel="noreferrer">OSM ↗</a>
          </span>
        </div>
      </div>

      <section className="card">
        <header className="card-head">
          <h3>Reports</h3>
          <span className="status-tally">
            {ORDER.filter((s) => byStatus[s]).map((s) => (
              <span key={s} className={`chip chip-${s}`}>{byStatus[s]} {s.replace('_', ' ')}</span>
            ))}
          </span>
        </header>
        {reports.length === 0 ? (
          <div className="empty">No reports linked.</div>
        ) : (
          <div className="inc-reports">
            {reports.map((r) => (
              <Link key={r.id} to={`/operator/reports/${r.id}`} className={`inc-report q-${r.status}`}>
                <div className="q-thumb">
                  {r.has_photo ? <img src={op.photoUrl(r.id)} alt="" loading="lazy" /> : <span className="muted small">no photo</span>}
                </div>
                <div className="q-body">
                  <div className="q-top">
                    <span className="mono">{shortId(r.id)}</span>
                    <StatusChip status={r.status} />
                    {r.review_reason && <span className="reason">{humanize(r.review_reason)}</span>}
                    <span className="muted small">{r.assessments.length} attempt{r.assessments.length === 1 ? '' : 's'} · {r.reviews.length} decision{r.reviews.length === 1 ? '' : 's'}</span>
                  </div>
                  <div className="q-desc">{r.description || <span className="muted">No description</span>}</div>
                  <div className="q-meta muted small">
                    Incident time {fmtTime(r.incident_time)} · submitted {ago(r.submitted_at)} · <span className="mono">{fmtCoord(r.latitude, r.longitude)}</span>
                  </div>
                  <FinalLine final={r.final} />
                  {r.current_assessment?.explanation && <p className="explain small">{r.current_assessment.explanation}</p>}
                  <SimulationNote sim={r.simulation} />
                </div>
                <span className="chev">›</span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
