// Typed client mirroring the API contract in app/PLAN.md. Do not deviate from shapes.

export type Category =
  | 'fire_smoke'
  | 'road_hazard'
  | 'infrastructure_damage'
  | 'waste_pollution'
  | 'other'
export type Level = 'low' | 'medium' | 'high'
export type Status = 'processing' | 'in_review' | 'published' | 'critical' | 'rejected' | 'failed'
export type Consistency = 'matches' | 'mismatches' | 'inconclusive' | 'not_applicable'
export type PhotoCheck = 'no_obvious_concerns' | 'suspicious' | 'inconclusive' | 'not_applicable'
export type IncidentState = 'provisional' | 'active' | 'merged'

export const CATEGORIES: Category[] = [
  'fire_smoke',
  'road_hazard',
  'infrastructure_damage',
  'waste_pollution',
  'other',
]
export const LEVELS: Level[] = ['low', 'medium', 'high']

export interface Confidence {
  low: number
  medium: number
  high: number
}

export interface Final {
  category: Category
  severity: Level
  urgency: Level
  source: 'model' | 'operator'
}

export interface Assessment {
  id: string
  attempt_no: number
  outcome: 'succeeded' | 'failed'
  category: Category | null
  severity: Level | null
  urgency: Level | null
  severity_confidence: Confidence | null
  urgency_confidence: Confidence | null
  photo_description_match: Consistency | null
  scene_plausibility: PhotoCheck | null
  time_consistency: PhotoCheck | null
  manipulation_concerns: PhotoCheck | null
  explanation: string | null
  error_code: string | null
  error_message: string | null
  model: string
  prompt_version: string
  started_at: string
  completed_at: string
}

export interface Review {
  id: string
  assessment_id: string | null
  action: 'approve' | 'reject'
  final_category: Category | null
  final_severity: Level | null
  final_urgency: Level | null
  operator_label: string
  comment: string | null
  decided_at: string
}

export interface Simulation {
  report_id: string
  incident_id: string
  radius_m: number
  recipient_count: number
  simulated_at: string
}

export interface ReportSummary {
  id: string
  status: Status
  description: string | null
  has_photo: boolean
  latitude: number
  longitude: number
  incident_time: string
  submitted_at: string
  incident_id: string | null
  review_reason: string | null
  final: Final | null
}

export interface ReportPublic extends ReportSummary {
  simulation: Simulation | null
  /** Other published reports in the same incident; 0 unless this report is published/critical. */
  incident_other_reports: number
}

export interface IncidentSibling {
  id: string
  status: Status
  description: string | null
  has_photo: boolean
  submitted_at: string
}

export interface ReportDetail extends ReportPublic {
  current_assessment: Assessment | null
  incident_state: IncidentState
  /** Other reports (any status) in the same incident, oldest first. */
  incident_reports: IncidentSibling[]
  assessments: Assessment[]
  reviews: Review[]
  processing_started_at: string | null
  updated_at: string
}

export interface IncidentMarker {
  id: string
  category: Category | null
  latitude: number
  longitude: number
  incident_time: string
  published_count: number
  max_severity: Level | null
}

/** Public view of a report: no description or photo. */
export interface IncidentPublicReport {
  id: string
  incident_time: string
  severity: Level | null
  urgency: Level | null
}

export interface IncidentPublic extends IncidentMarker {
  reports: IncidentPublicReport[]
}

export interface IncidentOp {
  id: string
  state: IncidentState
  category: Category | null
  latitude: number
  longitude: number
  incident_time: string
  created_at: string
  merged_into_id: string | null
  report_count: number
  published_count: number
  critical_count: number
}

export interface IncidentOpDetail extends IncidentOp {
  reports: ReportDetail[]
}

export interface Summary {
  processing: number
  in_review: number
  published: number
  critical: number
  rejected: number
  failed: number
  active_incidents: number
}

export interface SubmitResult {
  id: string
  status: Status
}

export interface ReviewBody {
  action: 'approve' | 'reject'
  final_category?: Category
  final_severity?: Level
  final_urgency?: Level
  operator_label: string
  comment?: string
}

// ---------------------------------------------------------------- errors

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** status 0 = network failure (request may or may not have reached the server). */
export const isNetworkError = (e: unknown) => e instanceof ApiError && e.status === 0

function detailToMessage(detail: unknown): string | null {
  if (!detail) return null
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail
      .map((d) => {
        if (d && typeof d === 'object' && 'msg' in d) {
          const loc = Array.isArray((d as { loc?: unknown[] }).loc)
            ? (d as { loc: unknown[] }).loc.filter((x) => x !== 'body').join('.')
            : ''
          return `${loc ? loc + ': ' : ''}${(d as { msg: string }).msg}`
        }
        return String(d)
      })
      .join('; ')
  }
  if (typeof detail === 'object') return JSON.stringify(detail)
  return String(detail)
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, init)
  } catch {
    throw new ApiError(0, 'Network error — check your connection and try again.')
  }
  const text = await res.text()
  let body: unknown = null
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
  }
  if (!res.ok) {
    const msg =
      (body && typeof body === 'object' && 'detail' in body
        ? detailToMessage((body as { detail: unknown }).detail)
        : typeof body === 'string' && body
          ? body.slice(0, 200)
          : null) ?? `${res.status} ${res.statusText}`
    throw new ApiError(res.status, msg)
  }
  return body as T
}

// ---------------------------------------------------------------- public

export interface SubmitPayload {
  submission_key: string
  receipt_token: string
  description: string
  photo: File | null
  latitude: number
  longitude: number
  incident_time: string // ISO with timezone
}

export function submitReport(p: SubmitPayload): Promise<SubmitResult> {
  const fd = new FormData()
  fd.append('submission_key', p.submission_key)
  fd.append('receipt_token', p.receipt_token)
  if (p.description.trim()) fd.append('description', p.description.trim())
  if (p.photo) fd.append('photo', p.photo, p.photo.name || 'photo.jpg')
  fd.append('latitude', p.latitude.toFixed(6))
  fd.append('longitude', p.longitude.toFixed(6))
  fd.append('incident_time', p.incident_time)
  return request<SubmitResult>('/api/reports', { method: 'POST', body: fd })
}

export function getReport(id: string, receiptToken: string): Promise<ReportPublic> {
  return request<ReportPublic>(`/api/reports/${encodeURIComponent(id)}`, {
    headers: { 'X-Receipt-Token': receiptToken },
  })
}

// Recovers the id of a submission whose response was lost (404 = server never stored it).
export function getReportByKey(submissionKey: string, receiptToken: string): Promise<SubmitResult> {
  return request<SubmitResult>(`/api/reports/by-key/${encodeURIComponent(submissionKey)}`, {
    headers: { 'X-Receipt-Token': receiptToken },
  })
}

/** Permanently deletes the report, its photo and its assessments (204). */
export function deleteReport(id: string, receiptToken: string): Promise<null> {
  return request<null>(`/api/reports/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'X-Receipt-Token': receiptToken },
  })
}

export const reportPhotoUrl = (id: string, receiptToken: string) =>
  `/api/reports/${encodeURIComponent(id)}/photo?token=${encodeURIComponent(receiptToken)}`

export const getIncidents = () => request<IncidentMarker[]>('/api/incidents')
export const getIncident = (id: string) =>
  request<IncidentPublic>(`/api/incidents/${encodeURIComponent(id)}`)

// ---------------------------------------------------------------- health & samples

export type AssessorMode = 'openai' | 'replay' | 'replay_first' | 'mock'

export interface Health {
  ok: boolean
  assessor: string
  mode?: AssessorMode // absent on older backends
  model?: string | null
  recorded_samples?: number
}

export interface Sample {
  id: string
  title: string
  description: string | null
  photo_url: string | null
  latitude: number
  longitude: number
  credit: string | null
  recorded: boolean
}

export const getHealth = () => request<Health>('/api/health')

export interface PrivacyInfo {
  retention_days: number
  rejected_retention_days: number
  assessor_mode: AssessorMode
}
export const getPrivacy = () => request<PrivacyInfo>('/api/privacy')
export const getSamples = () => request<Sample[]>('/api/samples')

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

/**
 * Downloads a sample photo as a File holding the exact served bytes (no re-encoding):
 * the replay assessor matches recorded output on a sha256 of the raw upload.
 */
export async function fetchSamplePhoto(s: Sample): Promise<File> {
  if (!s.photo_url) throw new Error('This sample has no photo.')
  let res: Response
  try {
    res = await fetch(s.photo_url)
  } catch {
    throw new ApiError(0, 'Network error — check your connection and try again.')
  }
  if (!res.ok) throw new ApiError(res.status, `Could not load the sample photo (${res.status}).`)
  const blob = await res.blob()
  const type = (blob.type || res.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase()
  return new File([blob], `${s.id}.${EXT[type] ?? 'jpg'}`, { type })
}

// ---------------------------------------------------------------- operator

const TOKEN_KEY = 'operatorToken'

export function getOperatorToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}
export function setOperatorToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* ignore */
  }
}

function opRequest<T>(url: string, init: RequestInit = {}): Promise<T> {
  const token = getOperatorToken() ?? ''
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${token}`)
  return request<T>(url, { ...init, headers })
}

export const op = {
  summary: () => opRequest<Summary>('/api/operator/summary'),
  reports: (status: Status) =>
    opRequest<ReportSummary[]>(`/api/operator/reports?status=${encodeURIComponent(status)}`),
  report: (id: string) => opRequest<ReportDetail>(`/api/operator/reports/${encodeURIComponent(id)}`),
  incidents: (state: IncidentState = 'active') =>
    opRequest<IncidentOp[]>(`/api/operator/incidents?state=${encodeURIComponent(state)}`),
  incident: (id: string) =>
    opRequest<IncidentOpDetail>(`/api/operator/incidents/${encodeURIComponent(id)}`),
  review: (id: string, body: ReviewBody) =>
    opRequest<ReportDetail>(`/api/operator/reports/${encodeURIComponent(id)}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  retry: (id: string) =>
    opRequest<ReportDetail>(`/api/operator/reports/${encodeURIComponent(id)}/retry`, {
      method: 'POST',
    }),
  photoUrl: (id: string) =>
    `/api/operator/reports/${encodeURIComponent(id)}/photo?token=${encodeURIComponent(getOperatorToken() ?? '')}`,
}
