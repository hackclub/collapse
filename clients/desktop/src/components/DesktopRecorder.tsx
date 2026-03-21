import { useState, useEffect, useCallback, useRef } from "react";
import {
  useSession,
  useSessionTimer,
  formatTime,
  Button,
  ErrorDisplay,
  PageContainer,
  Spinner,
  Skeleton,
  colors,
  spacing,
  fontSize,
  fontWeight,
  radii,
} from "@collapse/react";
import { getReport } from "../logger.js";
import { NamingModal } from "./NamingModal.js";
import { useNativeCapture } from "../hooks/useNativeCapture.js";
import type { CaptureSource } from "../hooks/useNativeCapture.js";
import { useScreenPreview } from "../hooks/useScreenPreview.js";
import { cardButtonStyle } from "./PageLayout.js";

interface DesktopRecorderProps {
  token: string;
  source: CaptureSource;
  onChangeSource: () => void;
  onBack: () => void;
  onViewSession: (token: string) => void;
}

const API_BASE = "https://collapse.b.selfhosted.hackclub.com";

export function DesktopRecorder({ token, source, onChangeSource, onBack, onViewSession }: DesktopRecorderProps) {
  const session = useSession();
  const capture = useNativeCapture(token, API_BASE, source);
  // Live preview runs until first capture arrives, then the captured frame takes over
  const { previewUrl: livePreviewUrl } = useScreenPreview(
    capture.lastScreenshotUrl ? null : source,
    2000,
  );
  const previewUrl = capture.lastScreenshotUrl || livePreviewUrl;
  const displaySeconds = useSessionTimer(
    capture.trackedSeconds || session.trackedSeconds,
    capture.isCapturing,
  );

  const [pauseLoading, setPauseLoading] = useState(false);
  const [resumeLoading, setResumeLoading] = useState(false);
  const [stopLoading, setStopLoading] = useState(false);
  const [isPrompting, setIsPrompting] = useState(false);
  const stopActionHandled = useRef(false);
  const autoStarted = useRef(false);

  // Auto-start recording when component mounts and session is ready (#5)
  useEffect(() => {
    if (autoStarted.current) return;
    if (session.status === "loading" || session.status === "error") return;
    const isActive = session.status === "active" || session.status === "pending";
    if (isActive && !capture.isCapturing) {
      autoStarted.current = true;
      capture.startCapturing();
    }
  }, [session.status, capture.isCapturing, capture]);

  // Navigate to session detail when terminal state is reached (#9)
  useEffect(() => {
    if (["stopped", "compiling", "complete", "failed"].includes(session.status) && !isPrompting && !stopLoading) {
      onViewSession(token);
    }
  }, [session.status, token, onViewSession, isPrompting, stopLoading]);

  // Finalize stop: optionally name, then stop the session.
  // Keep modal open during the stop so loading shows on modal button (#8)
  const handleConfirmStop = useCallback(async (name: string | null) => {
    if (stopActionHandled.current) return; // prevent duplicate calls
    stopActionHandled.current = true;
    setStopLoading(true);
    console.log(`[session] stopping, name: ${name?.trim() || "(none)"}`);
    if (name && name.trim()) {
      try {
        await fetch(`${API_BASE}/api/sessions/${token}/name`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim() }),
        });
      } catch (e) {
        console.warn("[session] rename failed (non-fatal):", e);
      }
    }

    try {
      await session.stop();
      console.log("[session] stopped, navigating to session detail");
      // Navigation happens via the useEffect watching session.status
      setIsPrompting(false);
      setStopLoading(false);
    } catch (e) {
      console.error("[session] failed to stop session", e);
      setStopLoading(false);
      stopActionHandled.current = false;
    }
  }, [token, session]);

  const handlePause = useCallback(async () => {
    console.log("[session] pausing...");
    setPauseLoading(true);
    capture.stopCapturing();
    await session.pause();
    console.log("[session] paused");
    setPauseLoading(false);
  }, [capture, session]);

  const handleResume = useCallback(async () => {
    console.log("[session] resuming...");
    setResumeLoading(true);
    await session.resume();
    await capture.startCapturing();
    console.log("[session] resumed");
    setResumeLoading(false);
  }, [capture, session]);

  // Stop button: pause session + stop capture + show naming modal
  const handleStopClick = useCallback(async () => {
    console.log("[session] stop clicked, pausing and opening naming modal");
    capture.stopCapturing();
    await session.pause();
    setIsPrompting(true);
  }, [capture, session]);

  // Resume from naming modal: close modal, resume recording
  const handleResumeFromModal = useCallback(async () => {
    console.log("[session] resume from modal, closing and resuming");
    setIsPrompting(false);
    setResumeLoading(true);
    await session.resume();
    await capture.startCapturing();
    setResumeLoading(false);
  }, [capture, session]);

  // Loading/skeleton state (#4)
  if (session.status === "loading") {
    return (
      <div style={{
        display: "flex", flexDirection: "column", height: "100%",
        maxWidth: 480, margin: "0 auto", padding: spacing.lg, boxSizing: "border-box",
      }}>
        <div style={{ flexShrink: 0, marginBottom: spacing.lg }}>
          <Skeleton height={56} borderRadius={radii.md} />
        </div>
        <div style={{ flex: 1 }}>
          <Skeleton aspectRatio="16/9" borderRadius={radii.lg} />
        </div>
        <div style={{ flexShrink: 0, display: "flex", gap: spacing.md, marginTop: spacing.lg }}>
          <Skeleton height={48} borderRadius={radii.lg} style={{ flex: 1 }} />
          <Skeleton height={48} borderRadius={radii.lg} style={{ flex: 1 }} />
        </div>
      </div>
    );
  }

  if (session.status === "error") {
    return (
      <PageContainer centered>
        <ErrorDisplay
          variant="page"
          title="Session Error"
          error={session.error || "Unknown error"}
          action={{ label: "\u2190 Gallery", onClick: onBack }}
        />
      </PageContainer>
    );
  }

  // Terminal states are handled by the useEffect above (navigates to session detail)
  // Show a brief loading state while navigation happens
  if (["stopped", "compiling", "complete", "failed"].includes(session.status)) {
    return (
      <PageContainer centered>
        <Spinner size="md" />
      </PageContainer>
    );
  }

  const isActive = session.status === "active" || session.status === "pending";
  const isPaused = session.status === "paused";

  // Pin controls to pre-action state during transitions to prevent flashes.
  let controlMode: "recording" | "paused";
  if (pauseLoading || ((stopLoading || isPrompting) && isActive)) {
    controlMode = "recording";
  } else if (resumeLoading || ((stopLoading || isPrompting) && isPaused)) {
    controlMode = "paused";
  } else if (capture.isCapturing) {
    controlMode = "recording";
  } else if (isPaused) {
    controlMode = "paused";
  } else {
    // During auto-start, show recording layout
    controlMode = "recording";
  }

  const screenshotCount = session.screenshotCount + capture.screenshotCount;

  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100%",
      maxWidth: 480, margin: "0 auto", padding: spacing.lg, boxSizing: "border-box",
    }}>
      {/* Status card — recording indicator + timer + screenshot count */}
      <div style={{
        flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: `${spacing.md}px ${spacing.xl}px`,
        background: colors.bg.surface, borderRadius: radii.md,
        border: `1px solid ${colors.border.default}`,
        marginBottom: spacing.lg,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: spacing.sm }}>
          {controlMode === "recording" && (
            <div style={{
              width: 10, height: 10, borderRadius: "50%", background: colors.status.danger,
              animation: "pulse 1.5s ease-in-out infinite", flexShrink: 0,
            }} />
          )}
          {controlMode === "paused" && (
            <span style={{ fontSize: fontSize.md, color: colors.text.tertiary, flexShrink: 0, lineHeight: 1 }}>
              ⏸︎
            </span>
          )}
          <span style={{
            fontSize: fontSize.timer,
            fontWeight: fontWeight.bold,
            fontVariantNumeric: "tabular-nums",
            color: colors.text.primary,
          }}>
            {formatTime(displaySeconds)}
          </span>
        </div>
        <span style={{ fontSize: fontSize.md, color: colors.text.secondary }}>
          {screenshotCount} {screenshotCount === 1 ? "screenshot" : "screenshots"}
        </span>
      </div>

      {/* Screen preview — fills available space */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", marginBottom: spacing.lg }}>
        {previewUrl ? (
          <div style={{
            position: "relative", borderRadius: radii.lg,
            overflow: "hidden", background: colors.bg.sunken, border: `1px solid ${colors.border.default}`,
            flex: 1, minHeight: 0,
          }}>
            <img
              src={previewUrl}
              alt="Screen preview"
              style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
            />
            <span style={{
              position: "absolute", bottom: 6, right: 6, fontSize: fontSize.xs,
              color: colors.badge.overlayText, background: colors.badge.overlayBg,
              padding: "2px 6px", borderRadius: radii.sm,
            }}>
              {capture.lastScreenshotUrl ? "Latest capture" : "Live preview"}
            </span>
          </div>
        ) : (
          <div style={{
            borderRadius: radii.lg, overflow: "hidden", background: colors.bg.sunken,
            border: `1px solid ${colors.border.default}`, aspectRatio: "16/9",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Spinner size="sm" />
          </div>
        )}
      </div>

      {capture.error && (
        <ErrorDisplay variant="banner" error={capture.error} onCopy={() => navigator.clipboard.writeText(getReport())} />
      )}

      {/* Buttons — half-and-half at bottom */}
      <div style={{ flexShrink: 0, display: "flex", gap: spacing.md }}>
        {controlMode === "recording" && (
          <>
            <Button
              variant="warning"
              size="lg"
              loading={pauseLoading}
              onClick={handlePause}
              disabled={stopLoading || isPrompting}
              fullWidth
              style={{ flex: 1 }}
            >
              Pause
            </Button>
            <Button
              variant="danger"
              size="lg"
              loading={stopLoading}
              onClick={handleStopClick}
              disabled={pauseLoading || stopLoading || isPrompting}
              fullWidth
              style={{ flex: 1 }}
            >
              Stop
            </Button>
          </>
        )}

        {controlMode === "paused" && (
          <>
            <Button
              variant="success"
              size="lg"
              loading={resumeLoading}
              onClick={handleResume}
              disabled={stopLoading || isPrompting}
              fullWidth
              style={{ flex: 1 }}
            >
              Resume
            </Button>
            <Button
              variant="danger"
              size="lg"
              loading={stopLoading}
              onClick={handleStopClick}
              disabled={resumeLoading || stopLoading || isPrompting}
              fullWidth
              style={{ flex: 1 }}
            >
              Stop
            </Button>
          </>
        )}
      </div>

      {isPrompting && (
        <NamingModal
          loading={stopLoading}
          onConfirm={handleConfirmStop}
          onResume={handleResumeFromModal}
        />
      )}
    </div>
  );
}
