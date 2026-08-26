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
            background: "var(--bg-base, #f6f7f9)",
            padding: 24,
          }}
        >
          <div
            style={{
              maxWidth: 520,
              width: "100%",
              background: "var(--bg-surface, #ffffff)",
              border: "1px solid var(--border, #d9dee5)",
              borderRadius: 8,
              padding: "28px 32px",
              boxShadow: "0 1px 2px rgba(15,23,42,0.08)",
            }}
          >
            <h1
              style={{
                fontSize: "1.25rem",
                fontWeight: 700,
                color: "var(--danger, #dc2626)",
                marginBottom: 8,
                letterSpacing: 0,
              }}
            >
              Something went wrong
            </h1>
            <p
              style={{
                color: "var(--text-secondary, #4b5563)",
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
                  background: "var(--bg-raised, #f1f3f5)",
                  border: "1px solid var(--border, #d9dee5)",
                  borderRadius: 8,
                  padding: "10px 12px",
                  fontSize: "0.75rem",
                  color: "var(--danger, #dc2626)",
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
                  background: "var(--brand, #2563eb)",
                  color: "#fff",
                  border: "none",
                  borderRadius: 6,
                  padding: "8px 18px",
                  fontWeight: 600,
                  fontSize: "0.875rem",
                  cursor: "pointer",
                }}
              >
                Back to Home
              </button>
              <button
                onClick={() => window.location.reload()}
                style={{
                  background: "var(--bg-surface, #ffffff)",
                  color: "var(--text-primary, #17202a)",
                  border: "1px solid var(--border, #d9dee5)",
                  borderRadius: 6,
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
