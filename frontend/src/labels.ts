import type { Category, Consistency, IncidentState, Level, PhotoCheck, Status } from './api'

export const CATEGORY_LABEL: Record<Category, string> = {
  fire_smoke: 'Fire / smoke',
  road_hazard: 'Road hazard',
  infrastructure_damage: 'Infrastructure damage',
  waste_pollution: 'Waste / pollution',
  other: 'Other',
}
export const CATEGORY_ICON: Record<Category, string> = {
  fire_smoke: '🔥',
  road_hazard: '⚠',
  infrastructure_damage: '🏗',
  waste_pollution: '🗑',
  other: '•',
}

export const LEVEL_LABEL: Record<Level, string> = { low: 'Low', medium: 'Medium', high: 'High' }

export const STATUS_LABEL: Record<Status, string> = {
  processing: 'Processing',
  in_review: 'Needs review',
  published: 'Published',
  critical: 'Critical',
  rejected: 'Rejected',
  failed: 'Failed',
}

export const CONSISTENCY_LABEL: Record<Consistency, string> = {
  matches: 'Matches',
  mismatches: 'Mismatch',
  inconclusive: 'Inconclusive',
  not_applicable: 'Not applicable',
}

export const PHOTO_CHECK_LABEL: Record<PhotoCheck, string> = {
  no_obvious_concerns: 'No obvious concerns',
  suspicious: 'Suspicious',
  inconclusive: 'Inconclusive',
  not_applicable: 'Not applicable',
}

export const INCIDENT_STATE_LABEL: Record<IncidentState, string> = {
  provisional: 'Provisional',
  active: 'Active',
  merged: 'Merged',
}

/** tone used for check results: good / warn / bad / muted */
export function checkTone(v: Consistency | PhotoCheck | null | undefined): string {
  switch (v) {
    case 'matches':
    case 'no_obvious_concerns':
      return 'good'
    case 'mismatches':
    case 'suspicious':
      return 'bad'
    case 'inconclusive':
      return 'warn'
    default:
      return 'muted'
  }
}

export const catLabel = (c: Category | null | undefined) => (c ? CATEGORY_LABEL[c] ?? c : 'Unclassified')
export const levelLabel = (l: Level | null | undefined) => (l ? LEVEL_LABEL[l] ?? l : '—')

/** humanize free-text machine reasons like "photo_description_mismatch" */
export function humanize(s: string | null | undefined): string {
  if (!s) return ''
  return s
    .split(', ')
    .map((p) => {
      if (/\s/.test(p)) return p
      const t = p.replace(/[_-]+/g, ' ').trim()
      return t.charAt(0).toUpperCase() + t.slice(1)
    })
    .join(', ')
}

const dtf = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})
export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? iso : dtf.format(d)
}

export function ago(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso).getTime()
  if (isNaN(d)) return ''
  const s = Math.round((Date.now() - d) / 1000)
  const abs = Math.abs(s)
  const fut = s < 0
  let out: string
  if (abs < 45) out = 'just now'
  else if (abs < 3600) out = `${Math.round(abs / 60)} min`
  else if (abs < 86400) out = `${Math.round(abs / 3600)} h`
  else out = `${Math.round(abs / 86400)} d`
  if (out === 'just now') return out
  return fut ? `in ${out}` : `${out} ago`
}

export const fmtCoord = (lat: number, lon: number) => `${lat.toFixed(5)}, ${lon.toFixed(5)}`
export const shortId = (id: string | null | undefined) => (id ? id.slice(0, 8) : '—')
