import React, { useRef, useEffect } from "react";
import { colors, radii, spacing, fontSize } from "../ui/theme.js";

export interface CameraPreviewProps {
  /** Live camera MediaStream to display. Shows nothing when null. */
  stream: MediaStream | null;
  /** Fallback static image URL (e.g. last captured screenshot). */
  fallbackImageUrl?: string | null;
}

/**
 * Live camera preview using a `<video>` element.
 * Falls back to a static image when no stream is provided.
 */
export function CameraPreview({ stream, fallbackImageUrl }: CameraPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (stream) {
      video.srcObject = stream;
      video.play().catch(() => {});
    } else {
      video.srcObject = null;
    }
  }, [stream]);

  if (!stream && !fallbackImageUrl) return null;

  return (
    <div
      style={{
        position: "relative",
        marginBottom: spacing.md,
        borderRadius: radii.md,
        overflow: "hidden",
        background: colors.bg.sunken,
        border: `1px solid ${colors.border.default}`,
      }}
    >
      {stream ? (
        <video
          ref={videoRef}
          muted
          playsInline
          autoPlay
          style={{ width: "100%", display: "block", transform: "scaleX(-1)" }}
        />
      ) : (
        fallbackImageUrl && (
          <img
            src={fallbackImageUrl}
            alt="Last captured frame"
            style={{ width: "100%", display: "block" }}
          />
        )
      )}
      <span
        style={{
          position: "absolute",
          bottom: 8,
          right: 8,
          fontSize: fontSize.xs,
          color: colors.text.tertiary,
          background: "rgba(0,0,0,0.7)",
          padding: "2px 8px",
          borderRadius: radii.sm,
        }}
      >
        {stream ? "Live preview" : "Latest capture"}
      </span>
    </div>
  );
}
