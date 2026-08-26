import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <section
      className="fade-in"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "60vh",
        textAlign: "center",
        gap: 16,
      }}
    >
      <h1
        style={{
          fontSize: "3rem",
          fontWeight: 700,
          letterSpacing: 0,
          color: "var(--text-primary)",
          lineHeight: 1,
          marginBottom: 4,
        }}
      >
        404
      </h1>
      <h2 style={{ color: "var(--text-secondary)", fontWeight: 500, fontSize: "1.125rem" }}>
        Page not found
      </h2>
      <p style={{ color: "var(--text-muted)", maxWidth: 340, fontSize: "0.9375rem" }}>
        The route you navigated to does not exist in Incident Atlas Pro.
      </p>
      <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
        <Link className="btn btn-primary" to="/" id="not-found-home-btn">
          Go home
        </Link>
        <Link className="btn btn-secondary" to="/incidents" id="not-found-incidents-btn">
          Incidents
        </Link>
      </div>
    </section>
  );
}
