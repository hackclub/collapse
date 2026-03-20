import React, { useState, useEffect, useCallback, useRef } from "react";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { listen } from "@tauri-apps/api/event";
import {
  useSession,
  useSessionTimer,
  StatusBar,
  ResultView,
  Button,
  ErrorDisplay,
  PageContainer,
  Card,
  Spinner,
  colors,
  spacing,
  fontSize,
  fontWeight,
  radii,
} from "@collapse/react";
import { getReport } from "../logger.js";
import { useNativeCapture } from "../hooks/useNativeCapture.js";
import type { CaptureSource } from "../hooks/useNativeCapture.js";
import { useScreenPreview } from "../hooks/useScreenPreview.js";

interface DesktopRecorderProps {
  token: string;
  source: CaptureSource;
  onChangeSource: () => void;
  onBack: () => void;
}

const API_BASE = "https://collapse.b.selfhosted.hackclub.com";

export function DesktopRecorder({ token, source, onChangeSource, onBack }: DesktopRecorderProps) {
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
  const [timelapseName, setTimelapseName] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);
  const stopActionHandled = useRef(false);

  // Focus the name input when the naming prompt appears
  useEffect(() => {
    if (isPrompting) {
      // Small timeout to allow the modal to render
      setTimeout(() => nameInputRef.current?.focus(), 50);
    }
  }, [isPrompting]);

  // Finalize stop: optionally name, then stop the session.
  const handleConfirmStop = useCallback(async (name: string | null) => {
    if (stopActionHandled.current) return; // prevent duplicate calls
    stopActionHandled.current = true;
    setIsPrompting(false);
    console.log(`[session] stopping, name: ${name?.trim() || "(none)"}`);
    setStopLoading(true);
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
      console.log("[session] stopped, transitioning to terminal state");
    } catch (e) {
      console.error("[session] failed to stop session", e);
      setStopLoading(false); // recover from error
      stopActionHandled.current = false;
    }
  }, [token, session]);

  const handleStart = useCallback(async () => {
    await capture.startCapturing();
  }, [capture]);

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

  // Stop button opens the naming prompt in a modal instead of a separate window
  const handleStopClick = useCallback(() => {
    console.log("[session] stop clicked, opening naming modal");
    setIsPrompting(true);
    capture.stopCapturing();
  }, [capture]);

  if (session.status === "loading") {
    return (
      <PageContainer centered>
        <Spinner size="md" />
        <p style={{ fontSize: fontSize.lg, color: colors.text.secondary, marginTop: spacing.md }}>
          Loading session...
        </p>
      </PageContainer>
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

  // Terminal states: render inline with back button and status bar still visible
  if (["stopped", "compiling", "complete", "failed"].includes(session.status)) {
    return (
      <PageContainer maxWidth={480} style={{ paddingTop: spacing.xl, width: "100%" }}>
        <Button variant="secondary" size="sm" onClick={onBack} style={{ marginBottom: spacing.md }}>
          &larr; Gallery
        </Button>
        <StatusBar
          displaySeconds={displaySeconds}
          screenshotCount={session.screenshotCount + capture.screenshotCount}
          uploads={{ pending: 0, completed: 0, failed: 0 }}
        />
        <div style={{ marginTop: spacing.lg, marginLeft: -spacing.lg, marginRight: -spacing.lg }}>
          <ResultView status={session.status} trackedSeconds={session.trackedSeconds} />
        </div>
      </PageContainer>
    );
  }

  const isActive = session.status === "active" || session.status === "pending";
  const isPaused = session.status === "paused";

  // Pin controls to pre-action state during transitions to prevent flashes.
  let controlMode: "recording" | "paused" | "idle";
  if (pauseLoading || ((stopLoading || isPrompting) && isActive)) {
    controlMode = "recording";
  } else if (resumeLoading || ((stopLoading || isPrompting) && isPaused)) {
    controlMode = "paused";
  } else if (capture.isCapturing) {
    controlMode = "recording";
  } else if (isPaused) {
    controlMode = "paused";
  } else {
    controlMode = "idle";
  }

  const isRecording = controlMode === "recording" || controlMode === "paused";

  // Format the recording date
  const dateStr = session.createdAt
    ? new Date(session.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : "";

  return (
    <PageContainer maxWidth={480} style={{ paddingTop: spacing.xl }}>
      {/* Back button — only when idle (not during recording) */}
      {!isRecording && (
        <Button variant="secondary" size="sm" onClick={onBack} style={{ marginBottom: spacing.md }}>
          &larr; Gallery
        </Button>
      )}

      {/* Session info */}
      {session.name && (
        <div style={{ marginBottom: spacing.md }}>
          <div style={{ fontSize: fontSize.lg, fontWeight: fontWeight.semibold, color: colors.text.primary }}>
            {session.name}
          </div>
          {dateStr && (
            <div style={{ fontSize: fontSize.xs, color: colors.text.tertiary, marginTop: 2 }}>
              {dateStr}
            </div>
          )}
        </div>
      )}

      <StatusBar
        displaySeconds={displaySeconds}
        screenshotCount={session.screenshotCount + capture.screenshotCount}
        uploads={{ pending: 0, completed: 0, failed: 0 }}
      />

      {/* Screen preview — shows captured frame after first capture, live preview before */}
      {previewUrl && (
        <div style={{
          position: "relative", marginBottom: spacing.md, borderRadius: radii.md,
          overflow: "hidden", background: colors.bg.sunken, border: `1px solid ${colors.border.default}`,
        }}>
          <img
            src={previewUrl}
            alt="Screen preview"
            style={{ width: "100%", display: "block" }}
          />
          <span style={{
            position: "absolute", bottom: 6, right: 6, fontSize: fontSize.xs,
            color: colors.badge.overlayText, background: colors.badge.overlayBg,
            padding: "2px 6px", borderRadius: radii.sm,
          }}>
            {capture.lastScreenshotUrl ? "Latest capture" : "Live preview"}
          </span>
        </div>
      )}

      {capture.error && (
        <ErrorDisplay variant="banner" error={capture.error} onCopy={() => navigator.clipboard.writeText(getReport())} />
      )}

      <div style={{
        display: "flex", alignItems: "center", gap: spacing.md,
        justifyContent: "center", flexWrap: "wrap",
      }}>
        {controlMode === "recording" && (
          <>
            <div style={{
              width: 10, height: 10, borderRadius: "50%", background: colors.status.danger,
              animation: "pulse 1.5s ease-in-out infinite",
            }} />
            <span style={{ fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.status.danger, marginRight: spacing.sm }}>
              Recording
            </span>
            <Button variant="warning" size="md" loading={pauseLoading} onClick={handlePause} disabled={stopLoading || isPrompting}>
              Pause
            </Button>
            <Button variant="danger" size="md" loading={stopLoading} onClick={handleStopClick} disabled={pauseLoading || stopLoading || isPrompting}>
              Stop
            </Button>
          </>
        )}

        {controlMode === "paused" && (
          <>
            <Button variant="primary" size="lg" loading={resumeLoading} onClick={handleResume} disabled={stopLoading || isPrompting}>
              Resume
            </Button>
            <Button variant="danger" size="lg" loading={stopLoading} onClick={handleStopClick} disabled={resumeLoading || stopLoading || isPrompting}>
              Stop Session
            </Button>
          </>
        )}

        {controlMode === "idle" && (
          <>
            <Button variant="success" size="lg" onClick={handleStart}>
              Start Recording
            </Button>
            <Button variant="secondary" size="sm" onClick={onChangeSource}>
              Change Source
            </Button>
          </>
        )}
      </div>

      {isPrompting && <NamingModal loading={stopLoading} onConfirm={handleConfirmStop} />}
    </PageContainer>
  );
}
