import React from "react";
import { colors, radii, fontSize, fontWeight, spacing } from "./theme.js";
import { Button } from "./Button.js";

export interface ErrorDisplayProps {
  error: string;
  variant?: "banner" | "inline" | "page";
  title?: string;
  onDismiss?: () => void;
  action?: { label: string; onClick: () => void };
}

export function ErrorDisplay({ error, variant = "banner", title, onDismiss, action }: ErrorDisplayProps) {
  if (variant === "page") {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: spacing.xxl, textAlign: "center" }}>
        <h2 style={{ fontSize: fontSize.heading, fontWeight: fontWeight.bold, color: colors.status.danger, marginBottom: spacing.sm }}>{title || "Error"}</h2>
        <pre style={{ margin: 0, fontSize: fontSize.xs, fontFamily: "monospace", whiteSpace: "pre-wrap", wordBreak: "break-all", maxWidth: 400, maxHeight: 150, overflowY: "auto", color: colors.text.error, marginBottom: spacing.lg }}>{error}</pre>
        {action && <Button variant="primary" size="md" onClick={action.onClick}>{action.label}</Button>}
      </div>
    );
  }

  if (variant === "inline") {
    return (
      <pre style={{ margin: 0, fontSize: fontSize.xs, fontFamily: "monospace", whiteSpace: "pre-wrap", wordBreak: "break-all", color: colors.text.error, maxHeight: 150, overflowY: "auto" }}>{error}</pre>
    );
  }

  // banner (default)
  return (
    <div style={{ padding: `${spacing.md}px ${spacing.lg}px`, marginBottom: spacing.md, background: "rgba(239,68,68,0.15)", border: `1px solid ${colors.status.danger}`, borderRadius: radii.md, color: colors.text.error, fontSize: fontSize.md, display: "flex", alignItems: "flex-start", gap: spacing.sm }}>
      <div style={{ flex: 1 }}>
        {title && <strong style={{ display: "block", marginBottom: spacing.xs }}>{title}</strong>}
        <pre style={{ margin: 0, fontSize: fontSize.xs, fontFamily: "monospace", whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 120, overflowY: "auto" }}>{error}</pre>
      </div>
      {onDismiss && <button onClick={onDismiss} style={{ background: "none", border: "none", color: colors.text.error, cursor: "pointer", fontSize: fontSize.xl, lineHeight: 1, padding: 0 }}>&times;</button>}
    </div>
  );
}
