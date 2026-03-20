import React from "react";
import { useCollapse } from "../hooks/useCollapse.js";
import { StatusBar } from "./StatusBar.js";
import { ScreenPreview } from "./ScreenPreview.js";
import { CameraPreview } from "./CameraPreview.js";
import { CameraSelector } from "./CameraSelector.js";
import { RecordingControls } from "./RecordingControls.js";
import { ProcessingState } from "./ProcessingState.js";
import { Button } from "../ui/Button.js";
import { Spinner } from "../ui/Spinner.js";
import { ErrorDisplay } from "../ui/ErrorDisplay.js";
import { PageContainer } from "../ui/PageContainer.js";
import { colors, fontSize, fontWeight, spacing } from "../ui/theme.js";

/**
 * Drop-in recorder widget. Handles the full lifecycle:
 * screen/camera capture, upload, pause/resume/stop, compilation, video playback.
 *
 * Adapts its UI based on the configured `capture.mode`:
 * - `"screen"` (default): screen sharing flow with `getDisplayMedia`
 * - `"camera"`: webcam flow with live preview, device picker, then recording
 *
 * Must be used within a `<CollapseProvider>`.
 */
export function CollapseRecorder() {
  const { state, actions } = useCollapse();

  if (state.status === "loading") {
    return (
      <PageContainer centered>
        <Spinner size="lg" />
      </PageContainer>
    );
  }

  if (state.status === "no-token") {
    return (
      <PageContainer centered>
        <h2 style={{ fontSize: fontSize.display, fontWeight: fontWeight.bold, color: colors.text.primary, marginBottom: spacing.sm }}>
          No session token
        </h2>
        <p style={{ fontSize: fontSize.xl, color: colors.text.secondary, textAlign: "center", maxWidth: 400 }}>
          This page requires a session token. You should have been redirected
          here from another service.
        </p>
      </PageContainer>
    );
  }

  if (state.status === "error") {
    return (
      <PageContainer centered>
        <ErrorDisplay error={state.error ?? "Unknown error"} variant="page" />
      </PageContainer>
    );
  }

  // Terminal states: show processing state inline
  if (
    state.status === "stopped" ||
    state.status === "compiling" ||
    state.status === "complete" ||
    state.status === "failed"
  ) {
    return (
      <PageContainer maxWidth={800} style={{ padding: spacing.xxl }}>
        <ProcessingState
          status={state.status}
          trackedSeconds={state.trackedSeconds}
        />
      </PageContainer>
    );
  }

  const isCamera = state.captureMode === "camera";

  // ─── Camera mode: preview → record flow ────────────────
  if (isCamera) {
    return (
      <PageContainer maxWidth={800} style={{ padding: spacing.xxl }}>
        <StatusBar
          displaySeconds={state.displaySeconds}
          screenshotCount={state.screenshotCount}
          uploads={state.uploads}
        />

        {/* Camera selector — show whenever devices are available and we're not mid-recording */}
        {state.availableCameras.length > 1 && (
          <CameraSelector
            devices={state.availableCameras}
            selectedDeviceId={state.selectedCameraId}
            onSelect={actions.selectCamera}
            disabled={state.isSharing}
          />
        )}

        {/* Preview/capture display */}
        {state.isPreviewing || state.previewStream ? (
          <CameraPreview
            stream={state.previewStream}
            fallbackImageUrl={state.lastScreenshotUrl}
          />
        ) : state.lastScreenshotUrl ? (
          <ScreenPreview imageUrl={state.lastScreenshotUrl} />
        ) : null}

        {/* Camera-specific controls */}
        {!state.isPreviewing && !state.isSharing ? (
          /* Phase 1: No stream yet — prompt to start camera */
          <CameraIdleControls
            status={state.status}
            onStartPreview={actions.startPreview}
            onStartRecording={actions.startSharing}
            onStop={actions.stop}
          />
        ) : state.isPreviewing && !state.isSharing ? (
          /* Phase 2: Previewing — show "Start Recording" */
          <CameraPreviewControls
            onStartRecording={actions.startSharing}
            onStopPreview={actions.stopPreview}
          />
        ) : (
          /* Phase 3: Recording — standard recording controls */
          <RecordingControls
            status={state.status}
            isSharing={state.isSharing}
            onStartSharing={actions.startSharing}
            onPause={actions.pause}
            onResume={actions.resume}
            onStop={actions.stop}
            captureMode="camera"
          />
        )}
      </PageContainer>
    );
  }

  // ─── Screen mode (default) ─────────────────────────────
  return (
    <PageContainer maxWidth={800} style={{ padding: spacing.xxl }}>
      <StatusBar
        displaySeconds={state.displaySeconds}
        screenshotCount={state.screenshotCount}
        uploads={state.uploads}
      />
      <ScreenPreview imageUrl={state.lastScreenshotUrl} />
      <RecordingControls
        status={state.status}
        isSharing={state.isSharing}
        onStartSharing={actions.startSharing}
        onPause={actions.pause}
        onResume={actions.resume}
        onStop={actions.stop}
        captureMode="screen"
      />
    </PageContainer>
  );
}

// ─── Camera sub-controls ─────────────────────────────────

/** Controls shown when camera is idle (no stream). */
function CameraIdleControls({
  status,
  onStartPreview,
  onStartRecording,
  onStop,
}: {
  status: string;
  onStartPreview: () => void;
  onStartRecording: () => void;
  onStop: () => void;
}) {
  const isPaused = status === "paused";

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: spacing.md,
      justifyContent: "center",
      flexWrap: "wrap",
    }}>
      {isPaused ? (
        <>
          <Button variant="primary" size="lg" onClick={onStartRecording}>
            Start Camera &amp; Resume
          </Button>
          <Button variant="danger" size="md" onClick={onStop}>
            Stop Session
          </Button>
        </>
      ) : (
        <Button variant="success" size="lg" onClick={onStartPreview}>
          Start Camera
        </Button>
      )}
    </div>
  );
}

/** Controls shown during camera preview (stream live, not recording). */
function CameraPreviewControls({
  onStartRecording,
  onStopPreview,
}: {
  onStartRecording: () => void;
  onStopPreview: () => void;
}) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: spacing.md,
      justifyContent: "center",
      flexWrap: "wrap",
    }}>
      <Button variant="success" size="lg" onClick={onStartRecording}>
        Start Recording
      </Button>
      <Button variant="secondary" size="md" onClick={onStopPreview}>
        Cancel
      </Button>
    </div>
  );
}
