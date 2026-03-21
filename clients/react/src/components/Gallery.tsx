import React, { useRef, useState, useEffect, useCallback } from "react";
import type { SessionSummary } from "@collapse/shared";
import { SessionCard } from "./SessionCard.js";
import { Button } from "../ui/Button.js";
import { ErrorDisplay } from "../ui/ErrorDisplay.js";
import { GallerySkeleton } from "../ui/Skeleton.js";
import { colors, spacing, fontSize, fontWeight, radii } from "../ui/theme.js";

export interface GalleryProps {
  sessions: SessionSummary[];
  loading: boolean;
  error: string | null;
  onSessionClick?: (token: string) => void;
  onArchive?: (token: string) => void;
  onRefresh?: () => void;
  onAdd?: () => void;
}

const addButtonStyle: React.CSSProperties = {
  background: colors.bg.surface,
  border: `1px solid ${colors.border.default}`,
  borderRadius: radii.lg,
  fontSize: fontSize.xxl,
  width: 36,
  height: 36,
  padding: 0,
};

function GalleryHeader({ onAdd }: { onAdd?: () => void }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: spacing.lg, paddingBottom: 0, flexShrink: 0 }}>
      <h2 style={{ fontSize: fontSize.heading, fontWeight: fontWeight.bold, color: colors.text.primary, margin: 0 }}>Your Timelapses</h2>
      {onAdd && (
        <Button variant="secondary" size="sm" onClick={onAdd} title="Add session" style={addButtonStyle}>
          +
        </Button>
      )}
    </div>
  );
}

export function Gallery({
  sessions,
  loading,
  error,
  onSessionClick,
  onArchive,
  onRefresh,
  onAdd,
}: GalleryProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showTopMask, setShowTopMask] = useState(false);
  const [showBottomMask, setShowBottomMask] = useState(false);

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setShowTopMask(scrollTop > 0);
    setShowBottomMask(Math.ceil(scrollTop + clientHeight) < scrollHeight);
  }, []);

  useEffect(() => {
    handleScroll();
    window.addEventListener('resize', handleScroll);
    return () => window.removeEventListener('resize', handleScroll);
  }, [sessions, handleScroll]);

  if (loading && sessions.length === 0) {
    return <GallerySkeleton />;
  }

  if (error && sessions.length === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <GalleryHeader onAdd={onAdd} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: spacing.xxl }}>
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
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <GalleryHeader onAdd={onAdd} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: spacing.xxl }}>
          <p style={{ marginBottom: spacing.md }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke={colors.text.primary} strokeWidth="1.5" style={{ opacity: 0.2 }}>
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          </p>
          <p style={{ fontSize: fontSize.lg, color: colors.text.primary, opacity: 0.5, textAlign: "center" }}>No timelapses yet</p>
          <p style={{ fontSize: fontSize.sm, color: colors.text.primary, opacity: 0.3, marginTop: spacing.xs, textAlign: "center" }}>
            Start a recording session to see it here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <GalleryHeader onAdd={onAdd} />
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: spacing.lg,
          maskImage: `linear-gradient(to bottom, ${showTopMask ? 'transparent 0%, black 20px' : 'black 0%, black 20px'}, ${showBottomMask ? 'black calc(100% - 20px), transparent 100%' : 'black calc(100% - 20px), black 100%'})`,
          WebkitMaskImage: `linear-gradient(to bottom, ${showTopMask ? 'transparent 0%, black 20px' : 'black 0%, black 20px'}, ${showBottomMask ? 'black calc(100% - 20px), transparent 100%' : 'black calc(100% - 20px), black 100%'})`,
        }}
      >
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
    </div>
  );
}
