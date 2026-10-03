import { NavLink, Outlet, useLocation } from 'react-router-dom'

export default function ClientLayout() {
  const loc = useLocation()
  const isMap = loc.pathname === '/map'
  return (
    <div className={`client ${isMap ? 'client-map' : ''}`}>
      <main className="client-main">
        <Outlet />
      </main>
      <nav className="tabbar" aria-label="Main">
        <NavLink to="/" end className="tab">
          <svg viewBox="0 0 24 24" aria-hidden><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
          <span>Report</span>
        </NavLink>
        <NavLink to="/map" className="tab">
          <svg viewBox="0 0 24 24" aria-hidden><path d="M12 21s-6-5.6-6-11a6 6 0 1 1 12 0c0 5.4-6 11-6 11z" /><circle cx="12" cy="10" r="2.2" /></svg>
          <span>Map</span>
        </NavLink>
        <NavLink to="/my" className={({ isActive }) => `tab ${isActive || loc.pathname.startsWith('/r/') ? 'active' : ''}`}>
          <svg viewBox="0 0 24 24" aria-hidden><path d="M6 3h9l3 3v15H6z" /><path d="M9 10h6M9 14h6M9 18h4" /></svg>
          <span>My reports</span>
        </NavLink>
      </nav>
    </div>
  )
}
