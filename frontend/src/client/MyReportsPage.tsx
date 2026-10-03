import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getReport } from '../api'
import type { Status } from '../api'
import { StatusChip, Empty } from '../components/ui'
import { loadMyReports, patchMyReport, removeMyReport } from '../storage'
import type { MyReport } from '../storage'
import { ago, fmtTime } from '../labels'

const STATUSES: Status[] = ['processing', 'in_review', 'published', 'critical', 'rejected', 'failed']
const asStatus = (s?: string) => (s && (STATUSES as string[]).includes(s) ? (s as Status) : null)

export default function MyReportsPage() {
  const [list, setList] = useState<MyReport[]>(() => loadMyReports())

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
                  <div className="muted small">Not confirmed by server — sending may have failed ({ago(r.created_at)})</div>
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
