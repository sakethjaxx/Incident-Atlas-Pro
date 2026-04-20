import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Top-level error boundary.
 * Catches unhandled render exceptions and shows a visible error card
 * instead of a blank page. Without this, any component crash silently
 * produces an empty #root in production.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary] Uncaught render error:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--bg-base, #080b12)",
            padding: 24,
          }}
        >
          <div
            style={{
              maxWidth: 520,
              width: "100%",
              background: "rgba(19, 25, 32, 0.9)",
              border: "1px solid rgba(248, 113, 113, 0.3)",
              borderRadius: 16,
              padding: "28px 32px",
              boxShadow: "0 8px 40px rgba(0,0,0,0.6)",
            }}
          >
            <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
            <h1
              style={{
                fontSize: "1.25rem",
                fontWeight: 700,
                color: "#f87171",
                marginBottom: 8,
                letterSpacing: "-0.02em",
              }}
            >
              Something went wrong
            </h1>
            <p
              style={{
                color: "#8b929e",
                fontSize: "0.875rem",
                lineHeight: 1.65,
                marginBottom: 16,
              }}
            >
              An unexpected error occurred while rendering Incident Atlas Pro.
              Check the browser console for the full stack trace.
            </p>
            {this.state.error && (
              <pre
                style={{
                  background: "#080b12",
                  border: "1px solid rgba(255,255,255,0.07)",
                  borderRadius: 8,
                  padding: "10px 12px",
                  fontSize: "0.75rem",
                  color: "#f87171",
                  overflowX: "auto",
                  marginBottom: 20,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {this.state.error.message}
              </pre>
            )}
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => window.location.assign("/")}
                style={{
                  background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
                  color: "#fff",
                  border: "none",
                  borderRadius: 9999,
                  padding: "8px 18px",
                  fontWeight: 600,
                  fontSize: "0.875rem",
                  cursor: "pointer",
                }}
              >
                ⬡ Back to Dashboard
              </button>
              <button
                onClick={() => window.location.reload()}
                style={{
                  background: "rgba(26, 34, 51, 0.8)",
                  color: "#e8eaf0",
                  border: "1px solid rgba(255,255,255,0.07)",
                  borderRadius: 9999,
                  padding: "8px 18px",
                  fontWeight: 600,
                  fontSize: "0.875rem",
                  cursor: "pointer",
                }}
              >
                Reload
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
