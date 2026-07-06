import { useEffect, useState } from "react";
import { NavLink, Route, Routes, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import Dashboard from "./routes/Dashboard";
import Search from "./routes/Search";
import Incidents from "./routes/Incidents";
import IncidentDetail from "./routes/IncidentDetail";
import Upload from "./routes/Upload";
import Graph from "./routes/Graph";
import Qa from "./routes/Qa";
import Eval from "./routes/Eval";
import NotFound from "./routes/NotFound";
import { getHealth } from "./lib/api";
import Icon, { type IconName } from "./components/Icon";

const NAV_ITEMS = [
  { to: "/", icon: "dashboard" as IconName, label: "Home", exact: true },
  { to: "/search", icon: "search" as IconName, label: "Search", exact: false },
  { to: "/incidents", icon: "incidents" as IconName, label: "Incidents", exact: false },
  { to: "/graph", icon: "graph" as IconName, label: "Patterns", exact: false },
  { to: "/qa", icon: "qa" as IconName, label: "Ask", exact: false },
  { to: "/upload", icon: "upload" as IconName, label: "Upload", exact: false },
  { to: "/eval", icon: "eval" as IconName, label: "Quality", exact: false },
];

function Breadcrumb() {
  const location = useLocation();
  const segments = location.pathname.split("/").filter(Boolean);

  if (segments.length === 0) {
    return (
      <span className="topbar-breadcrumb">
        <span>Home</span>
      </span>
    );
  }

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
      {crumbs.map((crumb, index) => (
        <span key={crumb.path}>
          {index > 0 && <span style={{ margin: "0 4px", opacity: 0.4 }}>/</span>}
          <span>{crumb.label}</span>
        </span>
      ))}
    </span>
  );
}

export default function App() {
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const { data: health, isLoading: healthLoading } = useQuery({
    queryKey: ["health"],
    queryFn: getHealth,
    refetchInterval: 30_000,
    retry: false,
  });

  const apiStatus = healthLoading
    ? { label: "Checking", color: "var(--text-secondary)", dot: "var(--text-secondary)" }
    : health?.ok
      ? { label: "API Live", color: "var(--brand)", dot: "var(--brand)" }
      : { label: "API Down", color: "var(--danger)", dot: "var(--danger)" };

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  return (
    <div className="app-shell">
      <div
        className={`sidebar-overlay${mobileNavOpen ? " open" : ""}`}
        onClick={() => setMobileNavOpen(false)}
        aria-hidden={!mobileNavOpen}
      />

      <aside className={`sidebar${mobileNavOpen ? " open" : ""}`}>
        <NavLink to="/" className="sidebar-logo" style={{ textDecoration: "none" }}>
          <div className="sidebar-logo-icon">IA</div>
          <div>
            <div className="sidebar-logo-text">Incident Atlas</div>
            <div className="sidebar-logo-sub">Incident memory</div>
          </div>
        </NavLink>

        <nav id="main-navigation" className="sidebar-nav" aria-label="Main navigation">
          <div className="sidebar-section-label">Navigation</div>

          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.exact}
              id={`nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
              className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}
              onClick={() => setMobileNavOpen(false)}
            >
              <span className="nav-item-icon">
                <Icon name={item.icon} size={16} />
              </span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">Operational knowledge base</div>
      </aside>

      <div className="main-content">
        <header className="topbar">
          <div className="topbar-leading">
            <button
              type="button"
              className="btn btn-secondary btn-icon mobile-menu-button"
              onClick={() => setMobileNavOpen((open) => !open)}
              aria-label={mobileNavOpen ? "Close navigation" : "Open navigation"}
              aria-expanded={mobileNavOpen}
              aria-controls="main-navigation"
            >
              <Icon name={mobileNavOpen ? "close" : "menu"} size={18} />
            </button>

            <NavLink to="/" className="topbar-brand" style={{ textDecoration: "none" }}>
              <div className="topbar-brand-mark">IA</div>
              <span>Incident Atlas</span>
            </NavLink>

            <Breadcrumb />
          </div>

          <div className="topbar-spacer" />

          <div className="topbar-actions">
            <span
              className="badge api-status-badge"
              style={{ borderColor: apiStatus.dot, color: apiStatus.color }}
              title={`API at ${import.meta.env.VITE_API_URL || "http://localhost:3001"}`}
            >
              <span
                className={health?.ok ? "dot-pulse" : undefined}
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: apiStatus.dot,
                  display: "inline-block",
                  flexShrink: 0,
                }}
              />
              <span className="api-status-label">{apiStatus.label}</span>
            </span>
          </div>
        </header>

        <main id="main-content" className="page-content fade-in">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/search" element={<Search />} />
            <Route path="/incidents" element={<Incidents />} />
            <Route path="/incidents/:id" element={<IncidentDetail />} />
            <Route path="/graph" element={<Graph />} />
            <Route path="/qa" element={<Qa />} />
            <Route path="/eval" element={<Eval />} />
            <Route path="/upload" element={<Upload />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
