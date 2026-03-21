import { useState, useEffect, useCallback } from "react";
import type { StatusResponse, VideoResponse, SessionResponse } from "@collapse/shared";
import { formatTrackedTime } from "../hooks/useSessionTimer.js";
import { Button } from "../ui/Button.js";
import { ErrorDisplay } from "../ui/ErrorDisplay.js";
import { ProcessingState } from "./ProcessingState.js";
import { SessionDetailSkeleton } from "../ui/Skeleton.js";
import { Card } from "../ui/Card.js";
import { Badge } from "../ui/Badge.js";
import { statusConfig, colors, spacing, fontSize, fontWeight, radii } from "../ui/theme.js";

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
  const [sessionInfo, setSessionInfo] = useState<{ name: string; createdAt: string } | null>(null);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch session info (name, createdAt) once
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${apiBaseUrl}/api/sessions/${token}`);
        if (res.ok) {
          const data: SessionResponse = await res.json();
          setSessionInfo({ name: data.name, createdAt: data.createdAt });
        }
      } catch {
        // Non-fatal — name display is optional
      }
    })();
  }, [token, apiBaseUrl]);

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

  const cardButtonStyle: React.CSSProperties = {
    background: colors.bg.surface,
    border: `1px solid ${colors.border.default}`,
    borderRadius: radii.lg,
  };

  return (
    <div style={{ padding: spacing.lg }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.lg }}>
        {onBack && (
          <Button variant="secondary" size="sm" onClick={onBack} style={cardButtonStyle}>
            &larr; Back
          </Button>
        )}
        <div style={{ display: "flex", gap: spacing.sm }}>
          {onArchive && (
            <Button variant="secondary" size="sm" onClick={onArchive} style={cardButtonStyle}>
              Archive
            </Button>
          )}
        </div>
      </div>

      {error && (
        <ErrorDisplay error={error} variant="banner" title="Error" />
      )}

      {!status && !error && <SessionDetailSkeleton />}

      {status && (
        <>
          {/* Video area */}
          <div style={{ marginBottom: spacing.lg, borderRadius: radii.lg, overflow: "hidden" }}>
            <ProcessingState
              status={status.status}
              trackedSeconds={status.trackedSeconds}
              videoUrl={videoUrl}
            />
          </div>

          {/* Session name + date */}
          {sessionInfo && (
            <div style={{ marginBottom: spacing.lg }}>
              <div style={{ fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.text.primary }}>
                {sessionInfo.name}
              </div>
              <div style={{ fontSize: fontSize.xs, color: colors.text.tertiary, marginTop: 2 }}>
                {new Date(sessionInfo.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
              </div>
            </div>
          )}

          {/* Stats */}
          <div style={{ display: "flex", gap: spacing.lg, justifyContent: "center" }}>
            <Card padding={`${spacing.md}px ${spacing.xxl}px`} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: spacing.xs }}>
              <span style={{ fontSize: fontSize.xxl, fontWeight: fontWeight.bold, color: colors.text.primary, height: 32, display: "flex", alignItems: "center" }}>
                {formatTrackedTime(status.trackedSeconds)}
              </span>
              <span style={{ fontSize: fontSize.xs, color: colors.text.tertiary }}>Tracked time</span>
            </Card>
            <Card padding={`${spacing.md}px ${spacing.xxl}px`} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: spacing.xs }}>
              <div style={{ height: 32, display: "flex", alignItems: "center" }}>
                <Badge status={status.status} variant="inline" size="lg" />
              </div>
              <span style={{ fontSize: fontSize.xs, color: colors.text.tertiary }}>Status</span>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
