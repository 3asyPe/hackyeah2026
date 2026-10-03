// Client-side receipts: what the reporter needs to look up their own reports.

export interface MyReport {
  id?: string
  submission_key: string
  receipt_token: string
  created_at: string
  description: string
  latitude: number
  longitude: number
  incident_time: string
  has_photo: boolean
  last_status?: string
}

const KEY = 'myReports'

export function loadMyReports(): MyReport[] {
  try {
    const raw = localStorage.getItem(KEY)
    const v = raw ? JSON.parse(raw) : []
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

function save(list: MyReport[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    /* storage unavailable */
  }
}

/** Insert or update by submission_key. */
export function upsertMyReport(r: Partial<MyReport> & { submission_key: string }) {
  const list = loadMyReports()
  const i = list.findIndex((x) => x.submission_key === r.submission_key)
  if (i >= 0) list[i] = { ...list[i], ...r }
  else list.unshift(r as MyReport)
  save(list)
}

export function patchMyReport(id: string, patch: Partial<MyReport>) {
  const list = loadMyReports()
  const i = list.findIndex((x) => x.id === id)
  if (i >= 0) {
    list[i] = { ...list[i], ...patch }
    save(list)
  }
}

export function removeMyReport(submissionKey: string) {
  save(loadMyReports().filter((x) => x.submission_key !== submissionKey))
}

export const findMyReport = (id: string) => loadMyReports().find((x) => x.id === id)

export function randomToken(): string {
  const b = new Uint8Array(24)
  crypto.getRandomValues(b)
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}

export function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  // fallback for non-secure contexts (e.g. phone over LAN http)
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
