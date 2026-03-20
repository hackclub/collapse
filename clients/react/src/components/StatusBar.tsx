import React from "react";
import { formatTime } from "../hooks/useSessionTimer.js";
import type { UploadState } from "../types.js";
import { colors, spacing, fontSize, fontWeight, radii } from "../ui/theme.js";

export interface StatusBarProps {
  displaySeconds: number;
  screenshotCount: number;
  uploads: UploadState;
}

export function StatusBar({ displaySeconds, screenshotCount, uploads }: StatusBarProps) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: `${spacing.md}px ${spacing.xl}px`,
      background: colors.bg.surface,
      borderRadius: radii.md,
      marginBottom: spacing.lg,
    }}>
      <div style={{
        fontSize: fontSize.timer,
        fontWeight: fontWeight.bold,
        fontVariantNumeric: "tabular-nums",
        color: colors.text.primary,
      }}>
        {formatTime(displaySeconds)}
      </div>
      <div style={{ display: "flex", gap: spacing.lg, fontSize: fontSize.lg, color: colors.text.secondary }}>
        <span>{screenshotCount} {screenshotCount === 1 ? "screenshot" : "screenshots"}</span>
        {uploads.pending > 0 && (
          <span style={{ color: colors.status.warning }}>{uploads.pending} uploading...</span>
        )}
        {uploads.failed > 0 && (
          <span style={{ color: colors.status.danger }}>{uploads.failed} failed</span>
        )}
      </div>
    </div>
  );
}
