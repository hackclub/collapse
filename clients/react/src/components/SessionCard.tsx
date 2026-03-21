import React from "react";
import { motion } from "motion/react";
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
        <motion.button
          whileTap="active"
          initial="idle"
          style={{
            position: "absolute",
            top: spacing.sm,
            left: spacing.sm,
            width: 24,
            height: 24,
            borderRadius: "50%",
            background: "transparent",
            color: "var(--color-archive-icon, #fff)",
            border: "none",
            cursor: "pointer",
            fontSize: fontSize.lg,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
            zIndex: 10,
          }}
          onClick={(e: any) => {
            e.stopPropagation();
            onArchive();
          }}
          onPointerDown={(e: any) => e.stopPropagation()}
          title="Archive"
        >
          <motion.div
            variants={{ idle: { scale: 1 }, active: { scale: 0.99 } }}
            transition={{ type: "spring", stiffness: 1500, damping: 60 }}
            style={{
              position: "absolute", inset: 0, borderRadius: "50%",
              background: "var(--color-archive-bg, rgba(0,0,0,0.6))",
              backdropFilter: "blur(4px)",
              WebkitBackdropFilter: "blur(4px)",
              border: `1px solid var(--color-archive-border, rgba(255,255,255,0.1))`,
              zIndex: 0,
              transition: "all 0.15s",
            }}
            onMouseEnter={(e: any) => {
              e.currentTarget.style.background = "var(--color-archive-hover-bg, rgba(255,255,255,0.1))";
              e.currentTarget.style.borderColor = "var(--color-archive-hover-border, rgba(255,255,255,0.2))";
              if (e.currentTarget.parentElement) {
                 e.currentTarget.parentElement.style.color = "var(--color-text-error, #ef4444)";
              }
            }}
            onMouseLeave={(e: any) => {
              e.currentTarget.style.background = "var(--color-archive-bg, rgba(0,0,0,0.6))";
              e.currentTarget.style.borderColor = "var(--color-archive-border, rgba(255,255,255,0.1))";
              if (e.currentTarget.parentElement) {
                 e.currentTarget.parentElement.style.color = "var(--color-archive-icon, #fff)";
              }
            }}
          />
          <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", justifyContent: "center", transition: "color 0.15s" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </div>
        </motion.button>
      )}
    </Card>
  );
}
