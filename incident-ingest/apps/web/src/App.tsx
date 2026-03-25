import { NavLink, Route, Routes, useLocation } from "react-router-dom";
import Dashboard from "./routes/Dashboard";
import Incidents from "./routes/Incidents";
import IncidentDetail from "./routes/IncidentDetail";
import Upload from "./routes/Upload";
import NotFound from "./routes/NotFound";

const NAV_ITEMS = [
  { to: "/", icon: "⬡", label: "Dashboard", exact: true },
  { to: "/incidents", icon: "📋", label: "Incidents", exact: false },
  { to: "/upload", icon: "⊕", label: "Manual Upload", exact: false },
];

function Breadcrumb() {
  const location = useLocation();
  const segments = location.pathname.split("/").filter(Boolean);

  if (segments.length === 0) return <span className="topbar-breadcrumb"><span>Dashboard</span></span>;

  const crumbs: { label: string; path: string }[] = [];
  let acc = "";
  for (const seg of segments) {
    acc += `/${seg}`;
    const isId = /^[0-9a-f-]{8,}$/i.test(seg);
    crumbs.push({
      label: isId ? "Detail" : seg.charAt(0).toUpperCase() + seg.slice(1),
      path: acc,
    });
  }

  return (
    <span className="topbar-breadcrumb">
      {crumbs.map((c, i) => (
        <span key={c.path}>
          {i > 0 && <span style={{ margin: "0 4px", opacity: 0.4 }}>/</span>}
          <span>{c.label}</span>
        </span>
      ))}
    </span>
  );
}

export default function App() {
  return (
    <div className="app-shell">
      {/* Sidebar */}
      <aside className="sidebar">
        <NavLink to="/" className="sidebar-logo" style={{ textDecoration: "none" }}>
          <div className="sidebar-logo-icon">🗺</div>
          <div>
            <div className="sidebar-logo-text">Incident Atlas</div>
            <div className="sidebar-logo-sub">Pro · MVP</div>
          </div>
        </NavLink>

        <nav className="sidebar-nav" aria-label="Main navigation">
          <div className="sidebar-section-label">Navigation</div>

          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.exact}
              id={`nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
              className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}
            >
              <span className="nav-item-icon">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}

          <div className="sidebar-section-label" style={{ marginTop: 8 }}>Coming Soon</div>

          {[
            { icon: "🔍", label: "Search" },
            { icon: "🕸", label: "Knowledge Graph" },
            { icon: "💬", label: "Q&A" },
          ].map((item) => (
            <div
              key={item.label}
              className="nav-item"
              style={{ opacity: 0.4, cursor: "not-allowed" }}
              title="Coming in Sprint 2–3"
            >
              <span className="nav-item-icon">{item.icon}</span>
              {item.label}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">Sprint 1 · Foundation</div>
      </aside>

      {/* Main content */}
      <div className="main-content">
        <header className="topbar">
          <Breadcrumb />
          <div className="topbar-spacer" />
          <span className="badge badge-brand">
            <span className="dot-pulse" style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--brand)", display: "inline-block" }} />
            API Live
          </span>
        </header>

        <main id="main-content" className="page-content fade-in">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/incidents" element={<Incidents />} />
            <Route path="/incidents/:id" element={<IncidentDetail />} />
            <Route path="/upload" element={<Upload />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
