import { useCallback, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { getOperatorToken, op, setOperatorToken } from '../api'
import { AiModeBadge } from '../components/ui'
import { useHealth } from '../hooks'
import { OperatorContext, useOpPoll } from './ctx'

function TokenGate({ onSubmit, message }: { onSubmit: (t: string) => void; message: string | null }) {
  const [value, setValue] = useState('demo')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (value.trim()) onSubmit(value.trim())
  }
  return (
    <div className="gate">
      <form className="gate-card" onSubmit={submit}>
        <div className="brand brand-lg">
          <span className="brand-mark">IR</span>
          <span>Operator console</span>
        </div>
        <p className="muted">Enter the operator access token to open the dashboard.</p>
        {message && <div className="alert alert-bad"><span>{message}</span></div>}
        <label className="op-label" htmlFor="tok">Operator token</label>
        <input id="tok" type="password" autoFocus value={value} onChange={(e) => setValue(e.target.value)} />
        <button className="btn btn-primary btn-block" type="submit">Open dashboard</button>
        <p className="muted small">Demo default: <code>demo</code></p>
      </form>
    </div>
  )
}

function Badge({ n, tone }: { n: number | undefined; tone: string }) {
  if (!n) return null
  return <span className={`nav-badge nb-${tone}`}>{n}</span>
}

function Shell() {
  const { data: s, error } = useOpPoll(op.summary, 'summary')
  const health = useHealth()
  return (
    <div className="op">
      <aside className="op-side">
        <Link to="/operator" className="brand">
          <span className="brand-mark">IR</span>
          <span>Operator</span>
        </Link>
        <nav className="op-nav">
          <NavLink to="/operator" end>
            <span>Overview</span>
          </NavLink>
          <NavLink to="/operator/critical">
            <span>Critical</span>
            <Badge n={s?.critical} tone="critical" />
          </NavLink>
          <NavLink to="/operator/review">
            <span>Review</span>
            <Badge n={s?.in_review} tone="in_review" />
          </NavLink>
          <NavLink to="/operator/failures">
            <span>Failures</span>
            <Badge n={s?.failed} tone="failed" />
          </NavLink>
        </nav>
        <div className="op-side-foot">
          <AiModeBadge health={health} dark />
          <div className={`live ${error ? 'live-off' : ''}`}>
            <span className="live-dot" /> {error ? 'API unreachable' : 'Live · 3 s'}
          </div>
          <SignOut />
          <Link to="/" className="muted small">← Reporter app</Link>
        </div>
      </aside>
      <main className="op-main">
        <Outlet />
      </main>
    </div>
  )
}

function SignOut() {
  return (
    <button
      className="btn btn-ghost btn-sm"
      onClick={() => {
        setOperatorToken(null)
        window.location.reload()
      }}
    >
      Change token
    </button>
  )
}

export default function OperatorLayout() {
  const [token, setToken] = useState<string | null>(() => getOperatorToken())
  const [message, setMessage] = useState<string | null>(null)
  const logout = useCallback((reason?: string) => {
    setOperatorToken(null)
    setToken(null)
    setMessage(reason ?? null)
  }, [])
  const ctx = useMemo(() => ({ logout }), [logout])

  if (!token) {
    return (
      <TokenGate
        message={message}
        onSubmit={(t) => {
          setOperatorToken(t)
          setToken(t)
          setMessage(null)
        }}
      />
    )
  }
  return (
    <OperatorContext.Provider value={ctx}>
      <Shell />
    </OperatorContext.Provider>
  )
}
