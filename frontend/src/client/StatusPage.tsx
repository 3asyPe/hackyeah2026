import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError, deleteReport, getReport, reportPhotoUrl } from '../api'
import type { ReportPublic, Status } from '../api'
import { usePoll } from '../hooks'
import { ErrorBox, FinalLine, SimulationNote, Spinner, StatusChip } from '../components/ui'
import { findMyReport, patchMyReport, removeMyReport } from '../storage'
import { fmtCoord, fmtTime } from '../labels'

function intervalFor(s: Status | undefined): number | null {
  if (!s || s === 'processing') return 2500
  // operator may act on these (review critical, retry failed, decide in_review); keep an eye on it
  if (s === 'in_review' || s === 'failed' || s === 'critical') return 5000
  if (s === 'published') return 10000 // operators can still retract; rare, so poll slowly
  return null // rejected is terminal
}

function groupedLine(n: number) {
  return `Grouped with ${n} other report${n === 1 ? '' : 's'} of the same incident.`
}

/** Erases the report on the server (or finds it already gone) and drops the copy kept on this device. */
function DeleteButton({ id, token, submissionKey }: { id: string; token: string; submissionKey: string }) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const onDelete = async () => {
    if (!window.confirm('Delete this report for good? The photo, description and assessment are erased and cannot be recovered.')) return
    setBusy(true)
    setErr(null)
    try {
      await deleteReport(id, token)
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 404)) {
        setErr(e instanceof Error ? e.message : 'Could not delete the report.')
        setBusy(false)
        return
      }
    }
    removeMyReport(submissionKey)
    navigate('/my', { replace: true })
  }
  return (
    <div className="delete-row">
      <button type="button" className="btn btn-danger btn-block" onClick={() => void onDelete()} disabled={busy}>
        {busy ? <Spinner size={18} /> : 'Delete report'}
      </button>
      {err && <div className="hint hint-bad">{err}</div>}
    </div>
  )
}

function Banner({ r }: { r: ReportPublic }) {
  const others = r.incident_other_reports
  switch (r.status) {
    case 'processing':
      return (
        <div className="banner banner-processing">
          <Spinner size={26} />
          <div>
            <strong>Assessing your report…</strong>
            <span>Checking the photo, description, place and time. This usually takes a few seconds.</span>
          </div>
        </div>
      )
    case 'in_review':
      return (
        <div className="banner banner-in_review">
          <span className="banner-ico">👁</span>
          <div>
            <strong>Needs human review</strong>
            <span>An operator will check this report before it is published.</span>
          </div>
        </div>
      )
    case 'published':
      return (
        <div className="banner banner-published">
          <span className="banner-ico">✓</span>
          <div>
            <strong>Published</strong>
            <span>Your report is linked to an incident on the public map.</span>
            {others > 0 && <strong className="banner-grouped">{groupedLine(others)}</strong>}
          </div>
        </div>
      )
    case 'critical':
      return (
        <div className="banner banner-critical">
          <span className="banner-ico">!</span>
          <div>
            <strong>Critical — high severity &amp; high urgency</strong>
            <span>
              <span className="sim-tag">SIMULATED</span> 112 escalation: forwarded to operator dashboard. No real emergency service was contacted — call 112 yourself if lives are at risk.
            </span>
            {others > 0 && <strong className="banner-grouped">{groupedLine(others)}</strong>}
          </div>
        </div>
      )
    case 'rejected':
      return (
        <div className="banner banner-rejected">
          <span className="banner-ico">✕</span>
          <div>
            <strong>Rejected</strong>
            <span>An operator reviewed this report and decided not to publish it.</span>
          </div>
        </div>
      )
    case 'failed':
      return (
        <div className="banner banner-failed">
          <span className="banner-ico">⚠</span>
          <div>
            <strong>Processing failed</strong>
            <span>The automated assessment did not complete. An operator will retry it — this page updates automatically.</span>
          </div>
        </div>
      )
  }
}

export default function StatusPage() {
  const { id = '' } = useParams()
  const mine = findMyReport(id)
  const token = mine?.receipt_token ?? ''
  const [iv, setIv] = useState<number | null>(2500)
  const { data: report, error: err, loading } = usePoll(() => getReport(id, token), mine ? iv : null, id)
  useEffect(() => {
    if (report) setIv(intervalFor(report.status))
  }, [report?.status]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (report) patchMyReport(id, { last_status: report.status })
  }, [id, report?.status]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!mine) {
    return (
      <div className="page">
        <header className="page-head">
          <h1>Report status</h1>
        </header>
        <div className="alert alert-warn">
          <strong>No receipt on this device</strong>
          <span>Report status is only visible on the device that submitted it.</span>
        </div>
        <Link className="btn btn-secondary btn-block" to="/my">My reports</Link>
      </div>
    )
  }

  if (!report) {
    return (
      <div className="page">
        <header className="page-head">
          <div className="eyebrow mono">Report {id.slice(0, 8)}</div>
          <h1>Report status</h1>
        </header>
        {loading || (!err) ? (
          <div className="banner banner-processing">
            <Spinner size={26} />
            <div><strong>Loading…</strong></div>
          </div>
        ) : (
          <ErrorBox error={err} title={err instanceof ApiError && err.status === 403 ? 'Receipt token rejected' : 'Could not load report'} />
        )}
        {err instanceof ApiError && err.status === 404 && (
          <>
            <p className="muted small">It may have been deleted after the retention period.</p>
            <DeleteButton id={id} token={token} submissionKey={mine.submission_key} />
          </>
        )}
      </div>
    )
  }

  return (
    <div className="page status">
      <header className="page-head">
        <div className="eyebrow mono">Report {report.id.slice(0, 8)}</div>
        <div className="row-between">
          <h1>Report status</h1>
          <StatusChip status={report.status} />
        </div>
      </header>

      <Banner r={report} />
      {err != null && <div className="hint hint-warn">Live update paused — retrying… ({(err as Error).message})</div>}

      {report.status === 'published' && report.incident_id && (
        <Link className="btn btn-primary btn-block" to={`/map?incident=${report.incident_id}`}>
          View incident on map →
        </Link>
      )}

      <SimulationNote sim={report.simulation} />

      {report.final && (
        <section className="card">
          <header className="card-head">
            <h3>Final classification</h3>
          </header>
          <FinalLine final={report.final} />
        </section>
      )}

      <section className="card">
        <header className="card-head">
          <h3>Your submission</h3>
        </header>
        {report.has_photo && (
          <img className="evidence-img" src={reportPhotoUrl(report.id, token)} alt="Submitted evidence" />
        )}
        <dl className="kv">
          <dt>Description</dt>
          <dd>{report.description || <span className="muted">—</span>}</dd>
          <dt>Location</dt>
          <dd className="mono">{fmtCoord(report.latitude, report.longitude)}</dd>
          <dt>Incident time</dt>
          <dd>{fmtTime(report.incident_time)}</dd>
          <dt>Submitted</dt>
          <dd>{fmtTime(report.submitted_at)}</dd>
        </dl>
      </section>
      <DeleteButton id={report.id} token={token} submissionKey={mine.submission_key} />
      <p className="disclaimer center">
        Submitted reports are read-only. Keep this device to follow updates. <Link to="/privacy">Privacy</Link>
      </p>
    </div>
  )
}
