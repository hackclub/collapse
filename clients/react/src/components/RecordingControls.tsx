import React from "react";
import type { RecorderStatus } from "../types.js";
import { Button } from "../ui/Button.js";
import { colors, spacing, fontSize, fontWeight } from "../ui/theme.js";

export interface RecordingControlsProps {
  status: RecorderStatus;
  isSharing: boolean;
  onStartSharing: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  loading?: boolean;
}

export function RecordingControls({
  status,
  isSharing,
  onStartSharing,
  onPause,
  onResume,
  onStop,
  loading,
}: RecordingControlsProps) {
  const isActive = status === "active" || status === "pending";
  const isPaused = status === "paused";

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: spacing.md,
      justifyContent: "center",
      flexWrap: "wrap",
    }}>
      {!isSharing && isActive && (
        <Button variant="success" size="lg" onClick={onStartSharing} loading={loading}>
          Share Screen &amp; Start Recording
        </Button>
      )}

      {!isSharing && isPaused && (
        <>
          <Button variant="primary" size="lg" onClick={onStartSharing} loading={loading}>
            Share Screen &amp; Resume
          </Button>
          <Button variant="danger" size="md" onClick={onStop}>
            Stop Session
          </Button>
        </>
      )}

      {isSharing && isActive && (
        <>
          <div style={{
            width: 12,
            height: 12,
            borderRadius: "50%",
            background: colors.status.danger,
            animation: "pulse 1.5s ease-in-out infinite",
          }} />
          <span style={{
            fontSize: fontSize.lg,
            fontWeight: fontWeight.semibold,
            color: colors.status.danger,
            marginRight: spacing.sm,
          }}>
            Recording
          </span>
          <Button variant="warning" size="md" onClick={onPause}>
            Pause
          </Button>
          <Button variant="danger" size="md" onClick={onStop}>
            Stop
          </Button>
        </>
      )}
    </div>
  );
}
