import React from "react";
import type { SessionSummary } from "@collapse/shared";
import { formatTrackedTime } from "../hooks/useSessionTimer.js";
import { Badge } from "../ui/Badge.js";
import { Card } from "../ui/Card.js";
import { colors, spacing, fontSize, fontWeight } from "../ui/theme.js";

export interface SessionCardProps {
  session: SessionSummary;
  onClick?: () => void;
  onArchive?: () => void;
}

export function SessionCard({ session, onClick, onArchive }: SessionCardProps) {
  const date = new Date(session.createdAt);
  const dateStr = date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
  });

  return (
    <Card onClick={onClick} style={{ position: "relative" }}>
      {/* Thumbnail */}
      <div style={{ position: "relative", aspectRatio: "16/9", background: colors.bg.sunken, overflow: "hidden" }}>
        {session.thumbnailUrl ? (
          <img
            src={session.thumbnailUrl}
            alt="Timelapse thumbnail"
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            loading="lazy"
          />
        ) : (
          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: colors.bg.sunken }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={colors.text.quaternary} strokeWidth="1.5">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          </div>
        )}
        <span style={{ position: "absolute", top: spacing.sm, right: spacing.sm }}>
          <Badge status={session.status} variant="overlay" />
        </span>
      </div>

      {/* Info */}
      <div style={{ padding: `${spacing.md}px ${spacing.md}px` }}>
        <div style={{
          fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text.primary,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 2,
        }}>
          {session.name}
        </div>
        <div style={{ fontSize: fontSize.xs, color: colors.text.tertiary }}>
          {formatTrackedTime(session.trackedSeconds)} &middot; {dateStr}
        </div>
      </div>

      {/* Archive button */}
      {onArchive && (
        <button
          style={{
            position: "absolute",
            top: 6,
            left: 6,
            width: 24,
            height: 24,
            borderRadius: "50%",
            background: "rgba(0,0,0,0.6)",
            color: colors.text.secondary,
            border: "none",
            cursor: "pointer",
            fontSize: fontSize.lg,
            lineHeight: "24px",
            textAlign: "center",
            padding: 0,
          }}
          onClick={(e) => {
            e.stopPropagation();
            onArchive();
          }}
          title="Archive"
        >
          &times;
        </button>
      )}
    </Card>
  );
}
