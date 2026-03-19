import React from "react";
import { Spinner } from "../ui/Spinner.js";
import { colors, radii, fontSize, fontWeight, spacing } from "../ui/theme.js";
import { formatTrackedTime } from "../hooks/useSessionTimer.js";

export interface ProcessingStateProps {
  status: string;
  trackedSeconds: number;
  videoUrl?: string | null;
  error?: string | null;
  onVideoLoaded?: () => void;
}

export function ProcessingState({ status, trackedSeconds, videoUrl, error, onVideoLoaded }: ProcessingStateProps) {
  const containerStyle: React.CSSProperties = {
    borderRadius: radii.lg,
    overflow: "hidden",
    background: colors.bg.sunken,
    aspectRatio: "16/9",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
  };

  if (status === "complete" && videoUrl) {
    return (
      <div style={{ borderRadius: radii.lg, overflow: "hidden", background: colors.bg.sunken, aspectRatio: "16/9" }}>
        <video src={videoUrl} controls autoPlay={false} style={{ width: "100%", height: "100%", display: "block" }} />
      </div>
    );
  }

  if (status === "complete" && error) {
    return (
      <div style={containerStyle}>
        <p style={{ fontSize: fontSize.lg, color: colors.text.secondary, textAlign: "center" }}>No video available</p>
      </div>
    );
  }

  if (status === "failed") {
    return (
      <div style={containerStyle}>
        <p style={{ fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.status.danger }}>Compilation failed</p>
        <p style={{ fontSize: fontSize.md, color: colors.text.secondary }}>It will be retried automatically.</p>
      </div>
    );
  }

  // stopped, compiling, or complete waiting for video URL
  return (
    <div style={containerStyle}>
      <Spinner size="lg" />
      <p style={{ fontSize: fontSize.lg, fontWeight: fontWeight.semibold, color: colors.text.primary }}>
        {status === "complete" ? "Loading video..." : "Compiling your timelapse..."}
      </p>
      <p style={{ fontSize: fontSize.md, color: colors.text.secondary }}>
        Tracked time: {formatTrackedTime(trackedSeconds)}
      </p>
    </div>
  );
}
