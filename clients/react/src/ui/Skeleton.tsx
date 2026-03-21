import React from "react";
import { colors, radii, spacing } from "./theme.js";

export interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  borderRadius?: number | string;
  aspectRatio?: string;
  style?: React.CSSProperties;
}

export function Skeleton({ width, height, borderRadius = radii.md, aspectRatio, style }: SkeletonProps) {
  return (
    <div style={{
      width: width ?? "100%",
      height: height ?? (aspectRatio ? undefined : 20),
      aspectRatio,
      borderRadius,
      backgroundColor: colors.skeleton.bg,
      backgroundImage: `linear-gradient(90deg, transparent 0%, ${colors.skeleton.shimmer} 50%, transparent 100%)`,
      backgroundSize: "200% 100%",
      animation: "shimmer 1.5s ease-in-out infinite",
      ...style,
    }} />
  );
}

export function GallerySkeleton() {
  return (
    <div style={{ padding: spacing.lg }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.lg }}>
        <Skeleton width={180} height={24} />
        <Skeleton width={36} height={36} borderRadius={radii.sm} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: spacing.md }}>
        {[1, 2, 3].map((i) => (
          <div key={i} style={{ borderRadius: radii.lg, overflow: "hidden" }}>
            <Skeleton aspectRatio="16/9" borderRadius={0} />
            <div style={{ padding: `${spacing.md}px ${spacing.md}px`, background: colors.bg.surface }}>
              <Skeleton width="60%" height={16} style={{ marginBottom: spacing.xs }} />
              <Skeleton width="40%" height={12} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SessionDetailSkeleton() {
  return (
    <div>
      <Skeleton aspectRatio="16/9" borderRadius={radii.lg} style={{ marginBottom: spacing.lg }} />
      <Skeleton width="50%" height={18} style={{ marginBottom: spacing.xs }} />
      <Skeleton width="30%" height={12} style={{ marginBottom: spacing.lg }} />
      <div style={{ display: "flex", gap: spacing.lg, justifyContent: "center" }}>
        <Skeleton height={64} borderRadius={radii.md} style={{ flex: 1 }} />
        <Skeleton height={64} borderRadius={radii.md} style={{ flex: 1 }} />
      </div>
    </div>
  );
}

export function RecordPageSkeleton() {
  return (
    <div style={{ maxWidth: 480, margin: "0 auto", padding: spacing.lg }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: spacing.lg }}>
        <Skeleton width={80} height={32} borderRadius={radii.sm} />
        <Skeleton width={100} height={32} borderRadius={radii.sm} />
      </div>
      <Skeleton aspectRatio="16/9" borderRadius={radii.lg} style={{ marginBottom: spacing.lg }} />
      <div style={{ display: "flex", flexDirection: "column", gap: spacing.sm }}>
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} height={48} borderRadius={radii.md} />
        ))}
      </div>
      <Skeleton height={48} borderRadius={radii.lg} style={{ marginTop: spacing.lg }} />
    </div>
  );
}
