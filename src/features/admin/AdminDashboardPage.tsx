import { useEffect, useState } from 'react'
import { getAdminOverview, type AdminOverview } from '../../application/auth/authClient'
import { useAuth } from '../../application/auth/AuthContext'

export function AdminDashboardPage() {
  const { user } = useAuth()
  const [overview, setOverview] = useState<AdminOverview | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    getAdminOverview()
      .then((value) => {
        if (active) setOverview(value)
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not load security monitoring.')
      })

    return () => {
      active = false
    }
  }, [])

  return (
    <section className="page-stack">
      <header className="page-header">
        <div>
          <span className="eyebrow">ADMIN / SECURITY</span>
          <h1>Usage and security activity.</h1>
          <p className="lede">Recent account events and AI usage metadata. Prompt and response contents are never included here.</p>
        </div>
      </header>
      {error && <div className="alert error" role="alert">{error}</div>}
      {overview ? (
        <>
          <section className="execution-analytics">
            <article className="metric-card"><span>Active accounts</span><strong>{overview.activeUsers}</strong><small>Not disabled</small></article>
            <article className="metric-card"><span>Daily AI limit</span><strong>{overview.dailyLimit}</strong><small>Per account, shared runs and evaluations</small></article>
            <article className="metric-card"><span>Events retained</span><strong>{overview.recentEvents.length}</strong><small>Latest security/account events</small></article>
            <article className="metric-card"><span>AI requests retained</span><strong>{overview.recentUsage.length}</strong><small>Metadata only</small></article>
          </section>
          <div className="admin-tables">
            <section className="panel">
              <div className="panel-heading"><div><span className="eyebrow">SECURITY EVENTS</span><h2>Recent activity</h2></div></div>
              {overview.recentEvents.length ? (
                <div className="table-scroll"><table className="admin-table">
                  <thead><tr><th>When</th><th>Account</th><th>Event</th><th>Outcome</th></tr></thead>
                  <tbody>{overview.recentEvents.map((event, index) => (
                    <tr key={`${event.created_at}-${index}`}>
                      <td>{new Date(event.created_at).toLocaleString()}</td>
                      <td>{event.email ?? 'Unidentified'}</td>
                      <td>{event.event_type.replaceAll('_', ' ')}</td>
                      <td>{event.outcome.replaceAll('_', ' ')}</td>
                    </tr>
                  ))}</tbody>
                </table></div>
              ) : <p className="muted">No security events recorded yet.</p>}
            </section>
            <section className="panel">
              <div className="panel-heading"><div><span className="eyebrow">AI USAGE</span><h2>Recent requests</h2></div></div>
              {overview.recentUsage.length ? (
                <div className="table-scroll"><table className="admin-table">
                  <thead><tr><th>When</th><th>Account</th><th>Type</th><th>Status</th><th>Tokens</th></tr></thead>
                  <tbody>{overview.recentUsage.map((item, index) => (
                    <tr key={`${item.created_at}-${index}`}>
                      <td>{new Date(item.created_at).toLocaleString()}</td>
                      <td>{item.email}</td>
                      <td>{item.request_type}</td>
                      <td>{item.status}</td>
                      <td>{item.total_tokens ?? '—'}</td>
                    </tr>
                  ))}</tbody>
                </table></div>
              ) : <p className="muted">No AI requests recorded yet.</p>}
            </section>
          </div>
          <p className="analytics-note">Signed in as {user?.email}. Security records retain event type and outcome for 90 days. Client IP addresses are HMAC-hashed and are not shown. This dashboard is operational monitoring, not a substitute for centralized alerting.</p>
        </>
      ) : !error ? <p role="status">Loading security activity…</p> : null}
    </section>
  )
}
