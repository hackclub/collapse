import React from "react";
import type { SessionSummary } from "@collapse/shared";
import { SessionCard } from "./SessionCard.js";
import { Button } from "../ui/Button.js";
import { ErrorDisplay } from "../ui/ErrorDisplay.js";
import { GallerySkeleton } from "../ui/Skeleton.js";
import { colors, spacing, fontSize, fontWeight } from "../ui/theme.js";

export interface GalleryProps {
  sessions: SessionSummary[];
  loading: boolean;
  error: string | null;
  onSessionClick?: (token: string) => void;
  onArchive?: (token: string) => void;
  onRefresh?: () => void;
}

export function Gallery({
  sessions,
  loading,
  error,
  onSessionClick,
  onArchive,
  onRefresh,
}: GalleryProps) {
  if (loading && sessions.length === 0) {
    return <GallerySkeleton />;
  }

  if (error && sessions.length === 0) {
    return (
      <div style={{ maxWidth: 640, margin: "0 auto", padding: spacing.lg }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.lg }}>
          <h2 style={{ fontSize: fontSize.heading, fontWeight: fontWeight.bold, color: colors.text.primary, margin: 0 }}>Your Timelapses</h2>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 300, padding: spacing.xxl }}>
          <ErrorDisplay error={error} variant="inline" />
          {onRefresh && (
            <Button variant="primary" size="md" onClick={onRefresh} style={{ marginTop: spacing.md }}>
              Retry
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div style={{ maxWidth: 640, margin: "0 auto", padding: spacing.lg }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.lg }}>
          <h2 style={{ fontSize: fontSize.heading, fontWeight: fontWeight.bold, color: colors.text.primary, margin: 0 }}>Your Timelapses</h2>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 300, padding: spacing.xxl }}>
          <p style={{ marginBottom: spacing.md }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke={colors.border.hover} strokeWidth="1.5">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          </p>
          <p style={{ fontSize: fontSize.lg, color: colors.text.secondary, textAlign: "center" }}>No timelapses yet</p>
          <p style={{ fontSize: fontSize.sm, color: colors.text.quaternary, marginTop: spacing.xs, textAlign: "center" }}>
            Start a recording session to see it here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: spacing.lg }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.lg }}>
        <h2 style={{ fontSize: fontSize.heading, fontWeight: fontWeight.bold, color: colors.text.primary, margin: 0 }}>Your Timelapses</h2>
        {onRefresh && (
          <Button variant="ghost" size="sm" onClick={onRefresh} title="Refresh" style={{ fontSize: fontSize.xxl }}>
            &#x21bb;
          </Button>
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: spacing.md }}>
        {sessions.map((s) => (
          <SessionCard
            key={s.token}
            session={s}
            onClick={() => onSessionClick?.(s.token)}
            onArchive={onArchive ? () => onArchive(s.token) : undefined}
          />
        ))}
      </div>
    </div>
  );
}
