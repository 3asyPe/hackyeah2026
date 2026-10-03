import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, getReport, getReportByKey } from '../api'
import type { Status } from '../api'
import { StatusChip, Empty } from '../components/ui'
import { loadMyReports, patchMyReport, removeMyReport, upsertMyReport } from '../storage'
import type { MyReport } from '../storage'
import { ago, fmtTime } from '../labels'

const STATUSES: Status[] = ['processing', 'in_review', 'published', 'critical', 'rejected', 'failed']
const asStatus = (s?: string) => (s && (STATUSES as string[]).includes(s) ? (s as Status) : null)
// The server only stores a report once the whole upload has arrived, so a 404 for a recent entry may just mean
// it is still being sent (another tab, or the user left mid-send). Only call it lost after this long.
const LOST_AFTER_MS = 2 * 60 * 1000
const isOld = (createdAt: string) => Date.now() - new Date(createdAt).getTime() > LOST_AFTER_MS

export default function MyReportsPage() {
  const [list, setList] = useState<MyReport[]>(() => loadMyReports())
  // submission_keys the server says it never stored (404 on lookup, and old enough not to be still uploading)
  const [lost, setLost] = useState<Set<string>>(() => new Set())

  // refresh statuses once on open
  useEffect(() => {
    let cancelled = false
    const items = loadMyReports().filter((r) => r.id)
    Promise.allSettled(items.map((r) => getReport(r.id!, r.receipt_token))).then((res) => {
      if (cancelled) return
      res.forEach((x, i) => {
        if (x.status === 'fulfilled') patchMyReport(items[i].id!, { last_status: x.value.status })
      })
      setList(loadMyReports())
    })
    return () => {
      cancelled = true
    }
  }, [])

  // recover ids of submissions whose response was lost (e.g. page reloaded mid-send)
  useEffect(() => {
    let cancelled = false
    const items = loadMyReports().filter((r) => !r.id)
    Promise.allSettled(items.map((r) => getReportByKey(r.submission_key, r.receipt_token))).then((res) => {
      if (cancelled) return
      const missing = new Set<string>()
      res.forEach((x, i) => {
        const key = items[i].submission_key
        if (x.status === 'fulfilled') upsertMyReport({ submission_key: key, id: x.value.id, last_status: x.value.status })
        else if (x.reason instanceof ApiError && x.reason.status === 404 && isOld(items[i].created_at)) missing.add(key)
      })
      setLost(missing)
      setList(loadMyReports())
    })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="page">
      <header className="page-head">
        <div className="eyebrow">Stored on this device</div>
        <h1>My reports</h1>
      </header>
      {list.length === 0 ? (
        <Empty>
          <p>No reports yet.</p>
          <Link to="/" className="btn btn-primary">Report an incident</Link>
        </Empty>
      ) : (
        <ul className="my-list">
          {list.map((r) =>
            r.id ? (
              <li key={r.submission_key}>
                <Link to={`/r/${r.id}`} className="my-item">
                  <div className="my-main">
                    <div className="my-desc">{r.description?.trim() || (r.has_photo ? 'Photo report' : 'Report')}</div>
                    <div className="muted small">
                      {fmtTime(r.incident_time)} · sent {ago(r.created_at)}
                    </div>
                  </div>
                  {asStatus(r.last_status) ? <StatusChip status={asStatus(r.last_status)!} /> : <span className="chip chip-neutral">—</span>}
                  <span className="chev">›</span>
                </Link>
              </li>
            ) : (
              <li key={r.submission_key} className="my-item my-unconfirmed">
                <div className="my-main">
                  <div className="my-desc">{r.description?.trim() || 'Unsent report'}</div>
                  <div className="muted small">
                    {lost.has(r.submission_key)
                      ? `Server never received this report — remove it and submit again (${ago(r.created_at)})`
                      : `Not confirmed by server — sending may have failed (${ago(r.created_at)})`}
                  </div>
                </div>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    removeMyReport(r.submission_key)
                    setList(loadMyReports())
                  }}
                >
                  Remove
                </button>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  )
}
