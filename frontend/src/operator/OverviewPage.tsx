import { Link, useNavigate } from 'react-router-dom'
import { op } from '../api'
import type { Summary } from '../api'
import { useOpPoll } from './ctx'
import { ErrorBox, Spinner } from '../components/ui'
import { CATEGORY_ICON, ago, catLabel, fmtCoord, fmtTime, shortId } from '../labels'
import { useNow } from '../hooks'

const COUNTERS: { k: keyof Summary; label: string; tone: string; to?: string }[] = [
  { k: 'critical', label: 'Critical', tone: 'critical', to: '/operator/critical' },
  { k: 'in_review', label: 'Needs review', tone: 'in_review', to: '/operator/review' },
  { k: 'failed', label: 'Failed', tone: 'failed', to: '/operator/failures' },
  { k: 'processing', label: 'Processing', tone: 'processing' },
  { k: 'published', label: 'Published', tone: 'published' },
  { k: 'rejected', label: 'Rejected', tone: 'rejected' },
  { k: 'active_incidents', label: 'Active incidents', tone: 'neutral' },
]

export default function OverviewPage() {
  useNow()
  const navigate = useNavigate()
  const summary = useOpPoll(op.summary, 'summary')
  const incidents = useOpPoll(() => op.incidents('active'), 'incidents-active')
  const rows = [...(incidents.data ?? [])].sort(
    (a, b) => b.critical_count - a.critical_count || +new Date(b.incident_time) - +new Date(a.incident_time),
  )

  return (
    <div className="op-page">
      <header className="op-head">
        <div>
          <div className="eyebrow">Dashboard</div>
          <h1>Overview</h1>
        </div>
      </header>

      <div className="counters">
        {COUNTERS.map((c) => {
          const n = summary.data?.[c.k]
          const body = (
            <>
              <span className="counter-n">{n ?? '–'}</span>
              <span className="counter-l">{c.label}</span>
            </>
          )
          const cls = `counter counter-${c.tone} ${n ? 'has' : ''}`
          return c.to ? (
            <Link key={c.k} to={c.to} className={cls}>{body}</Link>
          ) : (
            <div key={c.k} className={cls}>{body}</div>
          )
        })}
      </div>
      {summary.error != null && <ErrorBox error={summary.error} title="Summary unavailable" />}

      <section className="card">
        <header className="card-head">
          <h3>Active incidents</h3>
          <span className="muted small">{incidents.data ? `${rows.length} total` : ''}</span>
        </header>
        {incidents.loading && !incidents.data ? (
          <div className="pad center"><Spinner /></div>
        ) : incidents.error && !incidents.data ? (
          <ErrorBox error={incidents.error} title="Could not load incidents" />
        ) : rows.length === 0 ? (
          <div className="empty">No active incidents.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Incident</th>
                  <th>Category</th>
                  <th>Incident time</th>
                  <th>Location</th>
                  <th className="num">Reports</th>
                  <th className="num">Published</th>
                  <th className="num">Critical</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i.id} className={`clickable ${i.critical_count ? 'row-critical' : ''}`} onClick={() => navigate(`/operator/incidents/${i.id}`)}>
                    <td className="mono">
                      <Link to={`/operator/incidents/${i.id}`} onClick={(e) => e.stopPropagation()}>{shortId(i.id)}</Link>
                    </td>
                    <td>
                      <span className="cat-inline">{i.category ? CATEGORY_ICON[i.category] : '•'} {catLabel(i.category)}</span>
                    </td>
                    <td>
                      {fmtTime(i.incident_time)} <span className="muted small">{ago(i.incident_time)}</span>
                    </td>
                    <td className="mono small">{fmtCoord(i.latitude, i.longitude)}</td>
                    <td className="num">{i.report_count}</td>
                    <td className="num">{i.published_count}</td>
                    <td className="num">{i.critical_count ? <span className="chip chip-critical">{i.critical_count}</span> : <span className="muted">0</span>}</td>
                    <td className="muted small">{ago(i.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
