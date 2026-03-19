import React, { useState, useEffect, useCallback } from "react";
import type { StatusResponse, VideoResponse } from "@collapse/shared";
import { formatTime } from "../hooks/useSessionTimer.js";

export interface SessionDetailProps {
  token: string;
  apiBaseUrl: string;
  onBack?: () => void;
  onArchive?: () => void;
}

export function SessionDetail({
  token,
  apiBaseUrl,
  onBack,
  onArchive,
}: SessionDetailProps) {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${apiBaseUrl}/api/sessions/${token}/status`);
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status} from /api/sessions/${token}/status\n${body.slice(0, 500)}`);
      }
      const data: StatusResponse = await res.json();
      setStatus(data);

      // Fetch video URL when complete
      if (data.status === "complete" && !videoUrl) {
        try {
          const vRes = await fetch(`${apiBaseUrl}/api/sessions/${token}/video`);
          if (vRes.ok) {
            const v: VideoResponse = await vRes.json();
            setVideoUrl(v.videoUrl);
          }
        } catch {
          // Non-fatal
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [token, apiBaseUrl, videoUrl]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Poll while compiling
  useEffect(() => {
    if (!status || !["stopped", "compiling"].includes(status.status)) return;
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, [status?.status, fetchStatus]);

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        {onBack && (
          <button style={styles.backBtn} onClick={onBack}>
            &larr; Back
          </button>
        )}
        <div style={styles.headerRight}>
          {onArchive && (
            <button style={styles.archiveBtn} onClick={onArchive}>
              Archive
            </button>
          )}
        </div>
      </div>

      {error && (
        <div style={styles.errorBanner}>
          <strong style={{ display: "block", marginBottom: 4 }}>Error</strong>
          <pre style={styles.errorDetail}>{error}</pre>
        </div>
      )}

      {!status && !error && (
        <div style={styles.center}>
          <p style={styles.text}>Loading session...</p>
        </div>
      )}

      {status && (
        <>
          {/* Video player or status */}
          <div style={styles.videoWrap}>
            {videoUrl ? (
              <video
                src={videoUrl}
                controls
                style={styles.video}
                autoPlay={false}
              />
            ) : (
              <div style={styles.videoPlaceholder}>
                {status.status === "complete" ? (
                  <p style={styles.text}>No video available</p>
                ) : (
                  <>
                    <div style={styles.spinner} />
                    <p style={styles.text}>
                      {status.status === "compiling"
                        ? "Compiling timelapse..."
                        : "Processing..."}
                    </p>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Stats */}
          <div style={styles.stats}>
            <div style={styles.stat}>
              <span style={styles.statValue}>
                {formatTime(status.trackedSeconds)}
              </span>
              <span style={styles.statLabel}>Tracked time</span>
            </div>
            <div style={styles.stat}>
              <span style={{
                ...styles.statValue,
                color: statusColors[status.status] ?? "#888",
              }}>
                {statusLabels[status.status] ?? status.status}
              </span>
              <span style={styles.statLabel}>Status</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const statusLabels: Record<string, string> = {
  pending: "Pending",
  active: "Recording",
  paused: "Paused",
  stopped: "Processing",
  compiling: "Compiling",
  complete: "Complete",
  failed: "Failed",
};

const statusColors: Record<string, string> = {
  pending: "#888",
  active: "#22c55e",
  paused: "#f59e0b",
  stopped: "#3b82f6",
  compiling: "#3b82f6",
  complete: "#22c55e",
  failed: "#ef4444",
};

const styles: Record<string, React.CSSProperties> = {
  container: { maxWidth: 640, margin: "0 auto", padding: 16 },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  headerRight: { display: "flex", gap: 8 },
  backBtn: {
    padding: "6px 12px",
    fontSize: 13,
    fontWeight: 500,
    background: "transparent",
    color: "#888",
    border: "1px solid #444",
    borderRadius: 6,
    cursor: "pointer",
  },
  archiveBtn: {
    padding: "6px 12px",
    fontSize: 12,
    fontWeight: 500,
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
    minHeight: 200,
  },
  text: { fontSize: 14, color: "#888", textAlign: "center" },
  errorBanner: {
    padding: "10px 14px",
    marginBottom: 12,
    background: "rgba(239,68,68,0.15)",
    border: "1px solid #ef4444",
    borderRadius: 8,
    color: "#fca5a5",
    fontSize: 13,
  },
  errorDetail: {
    margin: 0,
    fontSize: 11,
    fontFamily: "monospace",
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-all" as const,
    maxHeight: 120,
    overflowY: "auto" as const,
    color: "#fca5a5",
  },
  videoWrap: {
    borderRadius: 10,
    overflow: "hidden",
    background: "#111",
    marginBottom: 16,
    aspectRatio: "16/9",
  },
  video: { width: "100%", height: "100%", display: "block" },
  videoPlaceholder: {
    width: "100%",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  spinner: {
    width: 24,
    height: 24,
    borderRadius: "50%",
    border: "3px solid #333",
    borderTopColor: "#3b82f6",
    animation: "spin 1s linear infinite",
  },
  stats: {
    display: "flex",
    gap: 16,
    justifyContent: "center",
  },
  stat: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 2,
    padding: "12px 24px",
    background: "#1a1a1a",
    border: "1px solid #333",
    borderRadius: 8,
    flex: 1,
  },
  statValue: { fontSize: 18, fontWeight: 700, color: "#fff" },
  statLabel: { fontSize: 11, color: "#666" },
};
