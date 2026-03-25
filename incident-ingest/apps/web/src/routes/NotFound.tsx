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
      <div
        style={{
          fontSize: 72,
          lineHeight: 1,
          marginBottom: 8,
          opacity: 0.3,
          filter: "grayscale(1)",
        }}
      >
        🗺
      </div>
      <h1
        style={{
          fontSize: "4rem",
          fontWeight: 800,
          letterSpacing: "-0.05em",
          background: "linear-gradient(135deg, var(--brand-from), var(--brand-to))",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          backgroundClip: "text",
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
        The route you navigated to doesn't exist in Incident Atlas Pro.
      </p>
      <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
        <Link className="btn btn-primary" to="/" id="not-found-home-btn">
          ⬡ Go to Dashboard
        </Link>
        <Link className="btn btn-secondary" to="/incidents" id="not-found-incidents-btn">
          Browse Incidents
        </Link>
      </div>
    </section>
  );
}
