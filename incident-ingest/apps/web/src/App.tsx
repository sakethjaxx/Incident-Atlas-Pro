import { NavLink, Route, Routes } from "react-router-dom";
import Dashboard from "./routes/Dashboard";
import Incidents from "./routes/Incidents";
import IncidentDetail from "./routes/IncidentDetail";
import Upload from "./routes/Upload";
import NotFound from "./routes/NotFound";

export default function App() {
  return (
    <div>
      <header>
        <div className="container">
          <nav>
            <NavLink to="/">Incident Atlas Pro</NavLink>
            <div className="links">
              <NavLink to="/incidents">Incidents</NavLink>
              <NavLink to="/upload">Manual upload</NavLink>
            </div>
          </nav>
        </div>
      </header>
      <main className="container">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/incidents" element={<Incidents />} />
          <Route path="/incidents/:id" element={<IncidentDetail />} />
          <Route path="/upload" element={<Upload />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </div>
  );
}
