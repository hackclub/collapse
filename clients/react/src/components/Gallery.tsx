import React from "react";
import type { SessionSummary } from "@collapse/shared";
import { SessionCard } from "./SessionCard.js";

export interface GalleryProps {
  sessions: SessionSummary[];
  loading: boolean;
  error: string | null;
  onSessionClick?: (token: string) => void;
  onArchive?: (token: string) => void;
  onRefresh?: () => void;
}

export function Gallery({
  sessions,
  loading,
  error,
  onSessionClick,
  onArchive,
  onRefresh,
}: GalleryProps) {
  if (loading && sessions.length === 0) {
    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <h2 style={styles.heading}>Your Timelapses</h2>
        </div>
        <div style={styles.center}>
          <p style={styles.text}>Loading...</p>
        </div>
      </div>
    );
  }

  if (error && sessions.length === 0) {
    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <h2 style={styles.heading}>Your Timelapses</h2>
        </div>
        <div style={styles.center}>
          <pre style={{ ...styles.text, color: "#fca5a5", whiteSpace: "pre-wrap", wordBreak: "break-all", fontFamily: "monospace", fontSize: 11, maxWidth: "100%", textAlign: "left" }}>{error}</pre>
          {onRefresh && (
            <button style={styles.retryBtn} onClick={onRefresh}>
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <h2 style={styles.heading}>Your Timelapses</h2>
        </div>
        <div style={styles.center}>
          <p style={styles.emptyIcon}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#444" strokeWidth="1.5">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          </p>
          <p style={styles.text}>No timelapses yet</p>
          <p style={{ ...styles.text, fontSize: 12, color: "#555", marginTop: 4 }}>
            Start a recording session to see it here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.heading}>Your Timelapses</h2>
        {onRefresh && (
          <button style={styles.refreshBtn} onClick={onRefresh} title="Refresh">
            &#x21bb;
          </button>
        )}
      </div>
      <div style={styles.grid}>
        {sessions.map((s) => (
          <SessionCard
            key={s.token}
            session={s}
            onClick={() => onSessionClick?.(s.token)}
            onArchive={onArchive ? () => onArchive(s.token) : undefined}
          />
        ))}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { maxWidth: 640, margin: "0 auto", padding: 16 },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  heading: { fontSize: 20, fontWeight: 700, color: "#fff", margin: 0 },
  refreshBtn: {
    padding: "6px 10px",
    fontSize: 18,
    background: "transparent",
    color: "#888",
    border: "1px solid #444",
    borderRadius: 6,
    cursor: "pointer",
  },
  center: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 300,
    padding: 24,
  },
  text: { fontSize: 14, color: "#888", textAlign: "center" },
  emptyIcon: { marginBottom: 12 },
  retryBtn: {
    marginTop: 12,
    padding: "8px 20px",
    fontSize: 13,
    fontWeight: 600,
    background: "#3b82f6",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    cursor: "pointer",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(240, 1fr))",
    gap: 12,
  },
};
