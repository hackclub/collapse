import React from "react";
import { useCollapse } from "../hooks/useCollapse.js";
import { StatusBar } from "./StatusBar.js";
import { ScreenPreview } from "./ScreenPreview.js";
import { RecordingControls } from "./RecordingControls.js";
import { ProcessingState } from "./ProcessingState.js";
import { Spinner } from "../ui/Spinner.js";
import { ErrorDisplay } from "../ui/ErrorDisplay.js";
import { PageContainer } from "../ui/PageContainer.js";
import { colors, fontSize, fontWeight, spacing } from "../ui/theme.js";

/**
 * Drop-in recorder widget. Handles the full lifecycle:
 * screen sharing, capture, upload, pause/resume/stop, compilation, video playback.
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

  // Recording states: pending, active, paused
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
      />
    </PageContainer>
  );
}
