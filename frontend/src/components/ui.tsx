import type { ReactNode } from 'react'
import type { Assessment, Confidence, Final, Health, Level, Simulation, Status } from '../api'
import { ApiError } from '../api'
import {
  CONSISTENCY_LABEL,
  PHOTO_CHECK_LABEL,
  STATUS_LABEL,
  catLabel,
  checkTone,
  fmtTime,
  levelLabel,
} from '../labels'

export function StatusChip({ status }: { status: Status }) {
  return (
    <span className={`chip chip-${status}`}>
      {status === 'processing' && <span className="dot-pulse" aria-hidden />}
      {STATUS_LABEL[status] ?? status}
    </span>
  )
}

export function LevelPill({ level, label }: { level: Level | null | undefined; label?: string }) {
  return (
    <span className={`level level-${level ?? 'none'}`}>
      {label && <span className="level-k">{label}</span>}
      {levelLabel(level)}
    </span>
  )
}

/** Small pill saying what assesses reports. Renders nothing until health is known (or if it failed). */
export function AiModeBadge({ health, dark = false }: { health: Health | null; dark?: boolean }) {
  if (!health?.mode) return null
  const model = health.model || null
  let text: string
  let title: string
  switch (health.mode) {
    case 'openai':
      text = `AI: ${model ?? 'OpenAI'}`
      title = `Reports are assessed live by OpenAI${model ? ` (${model})` : ''}.`
      break
    case 'replay':
      text = `AI: recorded ${model ?? 'model'} responses`
      title =
        `No API key configured. The bundled sample reports replay real, previously recorded ${model ?? 'model'} output` +
        `${health.recorded_samples ? ` (${health.recorded_samples} recorded)` : ''}; ` +
        'any other photo or description is assessed by a simple keyword mock.'
      break
    case 'replay_first':
      text = `AI: recorded samples + live ${model ?? 'OpenAI'}`
      title =
        `The bundled sample reports replay recorded output${health.recorded_samples ? ` (${health.recorded_samples} recorded)` : ''}; ` +
        `any other report is assessed live by ${model ?? 'OpenAI'}.`
      break
    case 'mock':
      text = 'AI: keyword mock'
      title = 'No AI model configured. Reports are classified by a simple keyword heuristic.'
      break
    default:
      return null
  }
  return (
    <span className={`ai-badge ai-${health.mode === 'replay_first' ? 'replay' : health.mode} ${dark ? 'ai-badge-dark' : ''}`} title={title}>
      <span className="ai-dot" aria-hidden />
      {text}
    </span>
  )
}

export function Spinner({ size = 20 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-label="Loading" />
}

export function ErrorBox({ error, title }: { error: unknown; title?: string }) {
  if (!error) return null
  const msg = error instanceof ApiError ? error.message : error instanceof Error ? error.message : String(error)
  const code = error instanceof ApiError && error.status ? ` (${error.status})` : ''
  return (
    <div className="alert alert-bad" role="alert">
      <strong>{title ?? 'Something went wrong'}{code}</strong>
      <span>{msg}</span>
    </div>
  )
}

export function ConfidenceBars({ title, conf, chosen }: { title: string; conf: Confidence | null; chosen?: Level | null }) {
  if (!conf) {
    return (
      <div className="conf">
        <div className="conf-title">{title}</div>
        <div className="muted small">No confidence reported (undetermined)</div>
      </div>
    )
  }
  const rows = (Object.entries(conf) as [Level, number][]).sort((a, b) => b[1] - a[1])
  return (
    <div className="conf">
      <div className="conf-title">{title}</div>
      {rows.map(([lvl, v]) => (
        <div key={lvl} className={`conf-row ${chosen === lvl ? 'is-chosen' : ''}`}>
          <span className="conf-lbl">{levelLabel(lvl)}</span>
          <span className="conf-track">
            <span className={`conf-fill fill-${lvl}`} style={{ width: `${Math.max(0, Math.min(100, v))}%` }} />
          </span>
          <span className="conf-val mono">{Math.round(v)}%</span>
        </div>
      ))}
    </div>
  )
}

export function CheckRow({ label, value, text }: { label: string; value: string | null; text: string }) {
  return (
    <div className="check-row">
      <span className="check-k">{label}</span>
      <span className={`check-v tone-${checkTone(value as never)}`}>{value ? text : '—'}</span>
    </div>
  )
}

export function FinalLine({ final }: { final: Final | null }) {
  if (!final) return <span className="muted">Not classified yet</span>
  return (
    <div className="final">
      <span className="final-cat">{catLabel(final.category)}</span>
      <LevelPill level={final.severity} label="Severity" />
      <LevelPill level={final.urgency} label="Urgency" />
      <span className={`source source-${final.source}`}>{final.source === 'operator' ? 'Operator decision' : 'Model'}</span>
    </div>
  )
}

export function AssessmentView({ a, compact = false }: { a: Assessment; compact?: boolean }) {
  if (a.outcome === 'failed') {
    return (
      <div className="assess assess-failed">
        <div className="assess-head">
          <span className="chip chip-failed">Attempt {a.attempt_no} · failed</span>
          <span className="muted small mono">{a.model}</span>
        </div>
        <div className="alert alert-bad">
          <strong>{a.error_code ?? 'error'}</strong>
          <span>{a.error_message ?? 'No error message'}</span>
        </div>
        <div className="muted small">{fmtTime(a.completed_at)}</div>
      </div>
    )
  }
  return (
    <div className="assess">
      {!compact && (
        <div className="assess-head">
          <span className="chip chip-neutral">Attempt {a.attempt_no}</span>
          <span className="muted small mono">
            {a.model} · {a.prompt_version} · {fmtTime(a.completed_at)}
          </span>
        </div>
      )}
      <div className="final">
        <span className="final-cat">{catLabel(a.category)}</span>
        <LevelPill level={a.severity} label="Severity" />
        <LevelPill level={a.urgency} label="Urgency" />
      </div>
      <div className="conf-grid">
        <ConfidenceBars title="Severity confidence" conf={a.severity_confidence} chosen={a.severity} />
        <ConfidenceBars title="Urgency confidence" conf={a.urgency_confidence} chosen={a.urgency} />
      </div>
      <div className="checks">
        <CheckRow
          label="Photo ↔ description"
          value={a.photo_description_match}
          text={a.photo_description_match ? CONSISTENCY_LABEL[a.photo_description_match] : ''}
        />
        <CheckRow
          label="Scene plausibility"
          value={a.scene_plausibility}
          text={a.scene_plausibility ? PHOTO_CHECK_LABEL[a.scene_plausibility] : ''}
        />
        <CheckRow
          label="Time-of-day consistency"
          value={a.time_consistency}
          text={a.time_consistency ? PHOTO_CHECK_LABEL[a.time_consistency] : ''}
        />
        <CheckRow
          label="AI generation / manipulation"
          value={a.manipulation_concerns}
          text={a.manipulation_concerns ? PHOTO_CHECK_LABEL[a.manipulation_concerns] : ''}
        />
      </div>
      {a.explanation && <p className="explain">{a.explanation}</p>}
      <p className="disclaimer">Automated assessment — not a guarantee of authenticity, time or location.</p>
    </div>
  )
}

export function SimulationNote({ sim }: { sim: Simulation | null }) {
  if (!sim) return null
  return (
    <div className="sim">
      <span className="sim-tag">SIMULATED</span>
      <span>
        <strong>{sim.recipient_count}</strong> nearby {sim.recipient_count === 1 ? 'person' : 'people'} notified within{' '}
        <strong>{sim.radius_m} m</strong>
        <span className="muted small"> · {fmtTime(sim.simulated_at)}</span>
      </span>
    </div>
  )
}

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="card">
      <header className="card-head">
        <h3>{title}</h3>
        {aside}
      </header>
      {children}
    </section>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>
}
