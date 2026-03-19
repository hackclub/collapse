import React, { useState, useEffect, useCallback, useRef } from "react";
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
  // Live preview always runs (local-only, no upload)
  const { previewUrl: livePreviewUrl } = useScreenPreview(source, 2000);
  const displaySeconds = useSessionTimer(
    capture.trackedSeconds || session.trackedSeconds,
    capture.isCapturing,
  );

  const [pauseLoading, setPauseLoading] = useState(false);
  const [resumeLoading, setResumeLoading] = useState(false);
  const [stopLoading, setStopLoading] = useState(false);
  const [showNamingPrompt, setShowNamingPrompt] = useState(false);
  const [timelapseName, setTimelapseName] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (capture.trackedSeconds > 0) {
      session.updateTrackedSeconds(capture.trackedSeconds);
    }
  }, [capture.trackedSeconds, session.updateTrackedSeconds]);

  // Auto-start/resume capturing once session is ready
  const autoStarted = React.useRef(false);
  useEffect(() => {
    const isTransitioning = pauseLoading || resumeLoading || stopLoading;
    if (!autoStarted.current && !capture.isCapturing && !isTransitioning) {
      if (session.status === "active" || session.status === "pending") {
        autoStarted.current = true;
        capture.startCapturing();
      } else if (session.status === "paused") {
        autoStarted.current = true;
        session.resume().then(() => capture.startCapturing());
      }
    }
  }, [session.status, capture.isCapturing, capture.startCapturing, pauseLoading, resumeLoading, stopLoading]);

  // Focus the name input when the naming prompt appears
  useEffect(() => {
    if (showNamingPrompt) {
      nameInputRef.current?.focus();
    }
  }, [showNamingPrompt]);

  const handleStart = useCallback(async () => {
    await capture.startCapturing();
  }, [capture.startCapturing]);

  const handlePause = useCallback(async () => {
    setPauseLoading(true);
    capture.stopCapturing();
    await session.pause();
    setPauseLoading(false);
  }, [capture, session]);

  const handleResume = useCallback(async () => {
    setResumeLoading(true);
    await session.resume();
    await capture.startCapturing();
    setResumeLoading(false);
  }, [capture, session]);

  // Stop button opens the naming prompt instead of immediately stopping
  const handleStopClick = useCallback(() => {
    capture.stopCapturing();
    setShowNamingPrompt(true);
  }, [capture]);

  // Finalize stop: optionally name, then stop the session.
  // Keep the naming prompt visible during the stop to prevent control flash.
  const handleConfirmStop = useCallback(async (name: string | null) => {
    setStopLoading(true);
    if (name && name.trim()) {
      try {
        await fetch(`${API_BASE}/api/sessions/${token}/name`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim() }),
        });
      } catch {
        // Non-fatal — the server will default to "untitled-YYYY-MM-DD"
      }
    }
    await session.stop();
    // After stop, session.status transitions to "stopped" and the terminal branch renders
  }, [token, session]);

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
      <PageContainer maxWidth={480} style={{ paddingTop: spacing.xl }}>
        <Button variant="secondary" size="sm" onClick={onBack} style={{ marginBottom: spacing.md }}>
          &larr; Gallery
        </Button>
        <StatusBar
          displaySeconds={displaySeconds}
          screenshotCount={capture.screenshotCount}
          uploads={{ pending: 0, completed: capture.screenshotCount, failed: 0 }}
        />
        <div style={{ marginTop: spacing.lg }}>
          <ResultView status={session.status} trackedSeconds={session.trackedSeconds} />
        </div>
      </PageContainer>
    );
  }

  const isActive = session.status === "active" || session.status === "pending";
  const isPaused = session.status === "paused";

  // Pin controls to pre-action state during transitions to prevent flashes.
  let controlMode: "recording" | "paused" | "idle";
  if (pauseLoading || (stopLoading && isActive)) {
    controlMode = "recording";
  } else if (resumeLoading || (stopLoading && isPaused)) {
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
      {!isRecording && !showNamingPrompt && (
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
        screenshotCount={capture.screenshotCount}
        uploads={{ pending: 0, completed: capture.screenshotCount, failed: 0 }}
      />

      {/* Screen preview */}
      {livePreviewUrl && (
        <div style={{
          position: "relative", marginBottom: spacing.md, borderRadius: radii.md,
          overflow: "hidden", background: colors.bg.sunken, border: `1px solid ${colors.border.default}`,
        }}>
          <img
            src={livePreviewUrl}
            alt="Screen preview"
            style={{ width: "100%", display: "block" }}
          />
        </div>
      )}

      {capture.error && (
        <ErrorDisplay variant="banner" error={capture.error} />
      )}

      {showNamingPrompt ? (
        <Card padding={spacing.xxl} style={{ textAlign: "center" }}>
          <h3 style={{ fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.text.primary, margin: 0, marginBottom: spacing.sm }}>
            Name your timelapse
          </h3>
          <p style={{ fontSize: fontSize.md, color: colors.text.secondary, margin: 0, marginBottom: spacing.lg }}>
            Give it a name, or skip to use the default.
          </p>
          <input
            ref={nameInputRef}
            type="text"
            value={timelapseName}
            onChange={(e) => setTimelapseName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleConfirmStop(timelapseName);
            }}
            placeholder="My timelapse"
            maxLength={255}
            disabled={stopLoading}
            style={{
              width: "100%",
              padding: `${spacing.md}px ${spacing.lg}px`,
              fontSize: fontSize.lg,
              fontWeight: fontWeight.medium,
              color: colors.text.primary,
              background: colors.bg.sunken,
              border: `1px solid ${colors.border.default}`,
              borderRadius: radii.md,
              outline: "none",
              boxSizing: "border-box",
              marginBottom: spacing.lg,
              opacity: stopLoading ? 0.5 : 1,
            }}
          />
          <div style={{ display: "flex", gap: spacing.md }}>
            <Button
              variant="primary"
              size="lg"
              fullWidth
              loading={stopLoading}
              onClick={() => handleConfirmStop(timelapseName)}
            >
              Save &amp; Stop
            </Button>
            <Button
              variant="secondary"
              size="lg"
              fullWidth
              loading={stopLoading}
              onClick={() => handleConfirmStop(null)}
            >
              Skip
            </Button>
          </div>
        </Card>
      ) : (
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
              <Button variant="warning" size="md" loading={pauseLoading} onClick={handlePause} disabled={stopLoading}>
                Pause
              </Button>
              <Button variant="danger" size="md" onClick={handleStopClick} disabled={pauseLoading}>
                Stop
              </Button>
            </>
          )}

          {controlMode === "paused" && (
            <>
              <Button variant="primary" size="lg" loading={resumeLoading} onClick={handleResume} disabled={stopLoading}>
                Resume
              </Button>
              <Button variant="danger" size="md" onClick={handleStopClick} disabled={resumeLoading}>
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
      )}
    </PageContainer>
  );
}
