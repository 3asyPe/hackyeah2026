import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ApiError, CATEGORIES, LEVELS, op } from '../api'
import type { Category, Level, ReportDetail, ReviewBody } from '../api'
import { useOpPoll, useOperator } from './ctx'
import { AssessmentView, ErrorBox, FinalLine, SimulationNote, Spinner, StatusChip } from '../components/ui'
import {
  CATEGORY_LABEL,
  INCIDENT_STATE_LABEL,
  LEVEL_LABEL,
  ago,
  catLabel,
  fmtCoord,
  fmtTime,
  humanize,
  levelLabel,
  shortId,
} from '../labels'

const LABEL_KEY = 'operatorLabel'
const loadLabel = () => {
  try {
    return localStorage.getItem(LABEL_KEY) ?? ''
  } catch {
    return ''
  }
}

function prefill(r: ReportDetail): { category: Category; severity: Level; urgency: Level } {
  const succeeded = [...r.assessments].reverse().find((a) => a.outcome === 'succeeded')
  const a = r.current_assessment?.outcome === 'succeeded' ? r.current_assessment : succeeded
  return {
    category: r.final?.category ?? a?.category ?? 'other',
    severity: r.final?.severity ?? a?.severity ?? 'medium',
    urgency: r.final?.urgency ?? a?.urgency ?? 'medium',
  }
}

function GroupingCard({ r }: { r: ReportDetail }) {
  const sibs = r.incident_reports
  return (
    <section className="card">
      <header className="card-head">
        <h3>Grouping</h3>
        {r.incident_state !== 'provisional' && (
          <Link className="small" to={`/operator/incidents/${r.incident_id}`}>Incident {shortId(r.incident_id ?? '')} →</Link>
        )}
      </header>
      {r.incident_state === 'provisional' ? (
        <div className="muted small">Not grouped yet. Grouping runs after the report is classified.</div>
      ) : sibs.length === 0 ? (
        <div className="muted small">Only report in this incident so far.</div>
      ) : (
        <>
          <div className="small grouped-count">
            Grouped with <strong>{sibs.length}</strong> other report{sibs.length === 1 ? '' : 's'}
          </div>
          <div className="inc-reports">
            {sibs.map((s) => (
              <Link key={s.id} to={`/operator/reports/${s.id}`} className={`inc-report inc-report-sm q-${s.status}`}>
                <div className="q-body">
                  <div className="q-top">
                    <span className="mono">{shortId(s.id)}</span>
                    <StatusChip status={s.status} />
                    <span className="muted small">{ago(s.submitted_at)}</span>
                  </div>
                  <div className="q-desc small">{s.description || <span className="muted">{s.has_photo ? 'Photo only' : 'No description'}</span>}</div>
                </div>
                <span className="chev">›</span>
              </Link>
            ))}
          </div>
        </>
      )}
    </section>
  )
}

function DecisionPanel({ r, onDone }: { r: ReportDetail; onDone: (d: ReportDetail) => void }) {
  const { logout } = useOperator()
  const init = prefill(r)
  const [category, setCategory] = useState<Category>(init.category)
  const [severity, setSeverity] = useState<Level>(init.severity)
  const [urgency, setUrgency] = useState<Level>(init.urgency)
  const [label, setLabel] = useState(loadLabel)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState<null | 'approve' | 'reject' | 'retry'>(null)
  const [error, setError] = useState<unknown>(null)

  const canDecide = r.status === 'in_review' || r.status === 'critical' || r.status === 'failed'
  const canRetract = r.status === 'published'
  const canRetry = r.status === 'failed'
  const willBeCritical = severity === 'high' && urgency === 'high'

  const run = async (kind: 'approve' | 'reject' | 'retry') => {
    if (busy) return
    if (kind !== 'retry' && !label.trim()) {
      setError(new Error('Operator label is required (your name or callsign).'))
      return
    }
    setBusy(kind)
    setError(null)
    try {
      let res: ReportDetail
      if (kind === 'retry') {
        res = await op.retry(r.id)
      } else {
        try {
          localStorage.setItem(LABEL_KEY, label.trim())
        } catch {
          /* ignore */
        }
        const body: ReviewBody =
          kind === 'approve'
            ? { action: 'approve', final_category: category, final_severity: severity, final_urgency: urgency, operator_label: label.trim() }
            : { action: 'reject', operator_label: label.trim() }
        if (comment.trim()) body.comment = comment.trim()
        res = await op.review(r.id, body)
        setComment('')
      }
      onDone(res)
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) logout('Token rejected (401).')
      setError(e)
    } finally {
      setBusy(null)
    }
  }

  const errTitle =
    error instanceof ApiError
      ? error.status === 409
        ? 'Conflict — report state changed'
        : error.status === 422
          ? 'Invalid decision'
          : 'Request failed'
      : 'Check the form'

  if (!canDecide && !canRetract) {
    return (
      <section className="card decision decision-closed">
        <header className="card-head"><h3>Decision</h3></header>
        <p className="muted small">
          {r.status === 'processing'
            ? 'Processing — the model is assessing this report. Decision options appear if it needs review or fails.'
            : `No action available: report is ${r.status.replace('_', ' ')}.`}
        </p>
      </section>
    )
  }

  return (
    <section className={`card decision decision-${r.status}`}>
      <header className="card-head">
        <h3>Operator decision</h3>
        <StatusChip status={r.status} />
      </header>
      {r.review_reason && (
        <div className="alert alert-warn">
          <strong>Why it is here</strong>
          <span>{humanize(r.review_reason)}</span>
        </div>
      )}
      <div className="form-grid">
        {!canRetract && (<>
        <label className="op-label">
          Category
          <select value={category} onChange={(e) => setCategory(e.target.value as Category)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
            ))}
          </select>
        </label>
        <div className="form-2">
          <label className="op-label">
            Severity
            <select value={severity} onChange={(e) => setSeverity(e.target.value as Level)}>
              {LEVELS.map((l) => (
                <option key={l} value={l}>{LEVEL_LABEL[l]}</option>
              ))}
            </select>
          </label>
          <label className="op-label">
            Urgency
            <select value={urgency} onChange={(e) => setUrgency(e.target.value as Level)}>
              {LEVELS.map((l) => (
                <option key={l} value={l}>{LEVEL_LABEL[l]}</option>
              ))}
            </select>
          </label>
        </div>
        {willBeCritical && (
          <div className="hint hint-bad">High + high → approving routes this report as <strong>critical</strong> (simulated 112).</div>
        )}
        </>)}
        <label className="op-label">
          Operator label
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. op-anna" />
        </label>
        <label className="op-label">
          Comment <span className="opt">optional</span>
          <textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Reason for the decision" />
        </label>
      </div>
      <ErrorBox error={error} title={errTitle} />
      <div className="decision-actions">
        {!canRetract && (
          <button className="btn btn-approve" disabled={!!busy} onClick={() => run('approve')}>
            {busy === 'approve' ? <Spinner size={16} /> : '✓'} Approve
          </button>
        )}
        <button className="btn btn-reject" disabled={!!busy} onClick={() => run('reject')}>
          {busy === 'reject' ? <Spinner size={16} /> : '✕'} {canRetract ? 'Retract (reject)' : 'Reject'}
        </button>
      </div>
      {canRetract && (
        <div className="hint">Removes this report from the public map. The incident disappears if no published reports remain.</div>
      )}
      {canRetry && (
        <div className="retry-box">
          <div className="muted small">Or run the model again on the same evidence (new attempt).</div>
          <button className="btn btn-secondary btn-block" disabled={!!busy} onClick={() => run('retry')}>
            {busy === 'retry' ? <Spinner size={16} /> : '↻'} Retry processing
          </button>
        </div>
      )}
    </section>
  )
}

export default function ReportDetailPage() {
  const { id = '' } = useParams()
  const { data, error, loading, refresh } = useOpPoll(() => op.report(id), `report-${id}`)
  const [override, setOverride] = useState<ReportDetail | null>(null)
  // a POST response is fresher than the last poll; drop it once the poll catches up
  useEffect(() => {
    if (override && data && data.updated_at >= override.updated_at) setOverride(null)
  }, [data, override])
  const r = override && (!data || override.updated_at > data.updated_at) ? override : data
  // back link follows the queue the operator came from, not the status after a decision
  const firstStatus = useRef<{ id: string; status: string } | null>(null)
  if (r && firstStatus.current?.id !== r.id) firstStatus.current = { id: r.id, status: r.status }
  const backStatus = firstStatus.current?.status

  if (loading && !r) return <div className="op-page pad center"><Spinner /></div>
  if (!r) return <div className="op-page"><ErrorBox error={error} title="Could not load report" /></div>

  const assessments = [...r.assessments].sort((a, b) => b.attempt_no - a.attempt_no)
  const reviews = [...r.reviews].sort((a, b) => +new Date(b.decided_at) - +new Date(a.decided_at))

  return (
    <div className="op-page">
      <header className="op-head">
        <div>
          <div className="eyebrow">
            <Link to={backStatus === 'critical' ? '/operator/critical' : backStatus === 'failed' ? '/operator/failures' : backStatus === 'in_review' ? '/operator/review' : '/operator'}>
              ← Back
            </Link>
          </div>
          <h1>
            Report <span className="mono">{shortId(r.id)}</span>
          </h1>
          <div className="muted small mono">{r.id}</div>
        </div>
        <div className="head-right">
          <StatusChip status={r.status} />
          {r.incident_id && (
            <Link className="btn btn-secondary btn-sm" to={`/operator/incidents/${r.incident_id}`}>
              Incident {shortId(r.incident_id)} · {INCIDENT_STATE_LABEL[r.incident_state] ?? r.incident_state}
            </Link>
          )}
        </div>
      </header>
      {error != null && <div className="hint hint-warn">Live update failed — showing last data.</div>}

      {r.status === 'critical' && (
        <div className="banner banner-critical">
          <span className="banner-ico">!</span>
          <div>
            <strong>Critical — high severity &amp; high urgency</strong>
            <span><span className="sim-tag">SIMULATED</span> 112 escalation delivered to this dashboard. No real emergency service was contacted.</span>
          </div>
        </div>
      )}

      <div className="detail-grid">
        <div className="detail-main">
          <section className="card">
            <header className="card-head"><h3>Evidence</h3><span className="muted small">read-only</span></header>
            {r.has_photo ? (
              <a href={op.photoUrl(r.id)} target="_blank" rel="noreferrer">
                <img className="evidence-img" src={op.photoUrl(r.id)} alt="Report photo" />
              </a>
            ) : (
              <div className="no-photo">No photo submitted</div>
            )}
            <dl className="kv">
              <dt>Description</dt>
              <dd>{r.description || <span className="muted">No description</span>}</dd>
              <dt>Location</dt>
              <dd>
                <span className="mono">{fmtCoord(r.latitude, r.longitude)}</span>{' '}
                <a className="small" href={`https://www.openstreetmap.org/?mlat=${r.latitude}&mlon=${r.longitude}#map=17/${r.latitude}/${r.longitude}`} target="_blank" rel="noreferrer">
                  OSM ↗
                </a>
              </dd>
              <dt>Incident time</dt>
              <dd>{fmtTime(r.incident_time)} <span className="muted small">{ago(r.incident_time)}</span></dd>
              <dt>Submitted</dt>
              <dd>{fmtTime(r.submitted_at)} <span className="muted small">{ago(r.submitted_at)}</span></dd>
              <dt>Processing started</dt>
              <dd>{fmtTime(r.processing_started_at)}</dd>
              <dt>Updated</dt>
              <dd>{fmtTime(r.updated_at)}</dd>
              {r.review_reason && (
                <>
                  <dt>Review reason</dt>
                  <dd>{humanize(r.review_reason)}</dd>
                </>
              )}
            </dl>
          </section>

          <section className="card">
            <header className="card-head">
              <h3>Assessment attempts</h3>
              <span className="muted small">{assessments.length} attempt{assessments.length === 1 ? '' : 's'}</span>
            </header>
            {assessments.length === 0 ? (
              <div className="empty small">
                {r.status === 'processing' ? <><Spinner size={16} /> Waiting for the model…</> : 'No model assessment (e.g. no photo and no description).'}
              </div>
            ) : (
              <div className="attempts">
                {assessments.map((a) => (
                  <div key={a.id} className={`attempt ${r.current_assessment?.id === a.id ? 'is-current' : ''}`}>
                    {r.current_assessment?.id === a.id && <span className="current-tag">current</span>}
                    <AssessmentView a={a} />
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="detail-side">
          <DecisionPanel key={`${r.id}:${r.status}:${r.reviews.length}`} r={r} onDone={(d) => { setOverride(d); refresh() }} />

          <section className="card">
            <header className="card-head"><h3>Final classification</h3></header>
            <FinalLine final={r.final} />
          </section>

          <GroupingCard r={r} />

          {r.simulation && (
            <section className="card">
              <header className="card-head"><h3>Notification simulation</h3></header>
              <SimulationNote sim={r.simulation} />
            </section>
          )}

          <section className="card">
            <header className="card-head"><h3>Review history</h3></header>
            {reviews.length === 0 ? (
              <div className="muted small">No operator decisions yet.</div>
            ) : (
              <ul className="history">
                {reviews.map((v) => (
                  <li key={v.id} className={`hist hist-${v.action}`}>
                    <div className="row-between">
                      <strong>{v.action === 'approve' ? 'Approved' : 'Rejected'}</strong>
                      <span className="muted small">{fmtTime(v.decided_at)}</span>
                    </div>
                    <div className="small">
                      by <span className="mono">{v.operator_label}</span>
                      {v.assessment_id && <span className="muted"> · on assessment {shortId(v.assessment_id)}</span>}
                    </div>
                    {v.action === 'approve' && (
                      <div className="small">
                        {catLabel(v.final_category)} · severity {levelLabel(v.final_severity)} · urgency {levelLabel(v.final_urgency)}
                      </div>
                    )}
                    {v.comment && <p className="hist-comment">“{v.comment}”</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
