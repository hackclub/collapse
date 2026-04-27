import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import type { StatusResponse, VideoResponse, SessionResponse } from "@lookout/shared";
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
  const [isRenaming, setIsRenaming] = useState(false);
  const [isRenamingAnim, setIsRenamingAnim] = useState(false);
  const [editName, setEditName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isRenaming) {
      setIsRenamingAnim(true);
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      }
    } else {
      // Small delay before showing icon again to let layout animations finish
      const t = setTimeout(() => setIsRenamingAnim(false), 600);
      return () => clearTimeout(t);
    }
  }, [isRenaming]);
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
              <div style={{ display: "flex", alignItems: "center", gap: spacing.xs, height: 32 }}>
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const newName = editName.trim();
                    if (newName && newName !== sessionInfo.name) {
                      try {
                        const res = await fetch(`${apiBaseUrl}/api/sessions/${token}/name`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ name: newName })
                        });
                        if (res.ok) {
                          setSessionInfo(prev => prev ? { ...prev, name: newName } : prev);
                        } else {
                          alert("Failed to rename session.");
                        }
                      } catch (err) {
                        alert("Error renaming session.");
                      }
                    }
                    setIsRenaming(false);
                    if (inputRef.current) inputRef.current.blur();
                  }}
                  style={{
                    display: "grid",
                    alignItems: "center",
                    margin: 0
                  }}
                >
                  <motion.span
                    animate={{
                      padding: isRenaming ? "0 16px" : "0 8px 0 0"
                    }}
                    transition={{ type: "spring", stiffness: 500, damping: 30 }}
                    style={{
                      gridArea: "1 / 1",
                      visibility: "hidden",
                      whiteSpace: "pre",
                      fontFamily: "inherit",
                      fontSize: fontSize.xl,
                      fontWeight: fontWeight.bold,
                      pointerEvents: "none"
                    }}
                  >
                    {isRenaming ? editName || " " : sessionInfo.name}
                  </motion.span>

                  <motion.input
                    ref={inputRef}
                    readOnly={!isRenaming}
                    value={isRenaming ? editName : sessionInfo.name}
                    onChange={(e) => setEditName(e.target.value)}
                    onBlur={() => setIsRenaming(false)}
                    onDoubleClick={() => {
                      if (!isRenaming) {
                        setEditName(sessionInfo.name);
                        setIsRenaming(true);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        setIsRenaming(false);
                        e.currentTarget.blur();
                      }
                    }}
                    size={1}
                    animate={{
                      padding: isRenaming ? "0 8px" : "0",
                      width: isRenaming ? "max(100%, 300px)" : "100%",
                      backgroundColor: isRenaming ? colors.bg.surface : "transparent",
                      borderColor: isRenaming ? colors.border.selected : "transparent"
                    }}
                    transition={{
                      padding: { type: "spring", stiffness: 500, damping: 30 },
                      width: { type: "spring", stiffness: 500, damping: 30 },
                      backgroundColor: { duration: 0.15 },
                      borderColor: { duration: 0.15 }
                    }}
                    style={{
                      gridArea: "1 / 1",
                      minWidth: 0,
                      height: 32,
                      fontFamily: "inherit",
                      fontSize: fontSize.xl,
                      fontWeight: fontWeight.bold,
                      color: colors.text.primary,
                      borderWidth: 1,
                      borderStyle: "solid",
                      borderRadius: radii.md,
                      boxSizing: "border-box",
                      outline: "none",
                      cursor: isRenaming ? "text" : "default",
                      transformOrigin: "left center"
                    }}
                  />
                </form>

                <div style={{ display: "flex", alignItems: "center", width: 24, height: 24 }}>
                  <AnimatePresence>
                    {!isRenamingAnim && (
                      <motion.button
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        transition={{ duration: 0.15 }}
                        title="Rename session"
                        onClick={() => {
                          setEditName(sessionInfo.name);
                          setIsRenaming(true);
                        }}
                        onMouseDown={(e) => e.currentTarget.style.transform = "scale(0.9)"}
                        onMouseUp={(e) => e.currentTarget.style.transform = "none"}
                        onMouseLeave={(e) => e.currentTarget.style.transform = "none"}
                        style={{
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          padding: 0,
                          margin: -5,
                          color: colors.text.tertiary,
                          display: "flex",
                          alignItems: "center",
                          transition: "transform 0.1s ease-in-out"
                        }}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
                        </svg>
                      </motion.button>
                    )}
                  </AnimatePresence>
                </div>
              </div>
              <motion.div
                animate={{
                  y: (isRenaming == false) ? -4 : 0
                }}
                transition={{ type: "spring", stiffness: 500, damping: 30 }}
                style={{ fontSize: fontSize.xs, color: colors.text.tertiary, marginTop: 2, y: -4 }}
              >
                {new Date(sessionInfo.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
              </motion.div>
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
