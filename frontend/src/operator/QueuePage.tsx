import { Link, useNavigate } from 'react-router-dom'
import { op } from '../api'
import type { Status } from '../api'
import { useOpPoll } from './ctx'
import { ErrorBox, FinalLine, Spinner, StatusChip } from '../components/ui'
import { ago, fmtCoord, fmtTime, humanize, shortId } from '../labels'
import { useNow } from '../hooks'

const META: Record<string, { title: string; blurb: string; empty: string }> = {
  critical: {
    title: 'Critical',
    blurb: 'High severity and high urgency. These were escalated through the SIMULATED 112 integration and land here for operator attention.',
    empty: 'No critical reports. 🎉',
  },
  in_review: {
    title: 'Review queue',
    blurb: 'Reports held back from publication: photo/description mismatch, missing evidence or undetermined classification.',
    empty: 'Review queue is empty.',
  },
  failed: {
    title: 'Processing failures',
    blurb: 'Model calls that failed or returned invalid output. Retry creates a new assessment attempt for the same report.',
    empty: 'No failed reports.',
  },
}

export default function QueuePage({ status }: { status: Status }) {
  useNow()
  const navigate = useNavigate()
  const meta = META[status]
  const { data, error, loading } = useOpPoll(() => op.reports(status), `q-${status}`)

  return (
    <div className="op-page">
      <header className="op-head">
        <div>
          <div className="eyebrow">Queue</div>
          <h1>{meta.title}</h1>
          <p className="muted op-blurb">{meta.blurb}</p>
        </div>
        {data && <span className={`counter-pill chip chip-${status}`}>{data.length}</span>}
      </header>

      {loading && !data ? (
        <div className="pad center"><Spinner /></div>
      ) : error && !data ? (
        <ErrorBox error={error} title="Could not load queue" />
      ) : !data || data.length === 0 ? (
        <div className="card empty">{meta.empty}</div>
      ) : (
        <div className="queue">
          {data.map((r) => (
            <div key={r.id} className={`q-row q-${r.status}`} onClick={() => navigate(`/operator/reports/${r.id}`)} role="button" tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/operator/reports/${r.id}`) }}>
              <div className="q-thumb">
                {r.has_photo ? <img src={op.photoUrl(r.id)} alt="" loading="lazy" /> : <span className="muted small">no photo</span>}
              </div>
              <div className="q-body">
                <div className="q-top">
                  <Link to={`/operator/reports/${r.id}`} className="mono" onClick={(e) => e.stopPropagation()}>{shortId(r.id)}</Link>
                  <StatusChip status={r.status} />
                  {r.review_reason && <span className="reason">{humanize(r.review_reason)}</span>}
                </div>
                <div className="q-desc">{r.description || <span className="muted">No description</span>}</div>
                <div className="q-meta muted small">
                  Incident time {fmtTime(r.incident_time)} · submitted {ago(r.submitted_at)} · <span className="mono">{fmtCoord(r.latitude, r.longitude)}</span>
                </div>
                {r.final && <FinalLine final={r.final} />}
              </div>
              <span className="chev">›</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
