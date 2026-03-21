import React from "react";
import {
  Button,
  colors,
  spacing,
  fontSize,
  fontWeight,
  radii,
} from "@collapse/react";

export const cardButtonStyle: React.CSSProperties = {
  background: colors.bg.surface,
  border: `1px solid ${colors.border.default}`,
  borderRadius: radii.lg,
};

interface PageLayoutProps {
  /** Show a back button at top-left */
  onBack?: () => void;
  /** Circular icon content (SVG or text) displayed above the title */
  icon?: React.ReactNode;
  /** Main heading */
  title?: string;
  /** Subtitle / description */
  subtitle?: string;
  /** Smaller helper text below subtitle */
  hint?: string;
  /** Bottom-pinned actions (buttons, inputs, etc.) */
  actions?: React.ReactNode;
  children?: React.ReactNode;
}

export function PageLayout({ onBack, icon, title, subtitle, hint, actions, children }: PageLayoutProps) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100%",
      maxWidth: 480, margin: "0 auto", padding: spacing.lg, boxSizing: "border-box",
    }}>
      {/* Back button */}
      {onBack && (
        <div style={{ flexShrink: 0 }}>
          <Button variant="secondary" size="sm" onClick={onBack} style={cardButtonStyle}>
            &larr; Back
          </Button>
        </div>
      )}

      {/* Centered content area */}
      <div style={{
        flex: 1, display: "flex", flexDirection: "column",
        justifyContent: "center", alignItems: "center",
        textAlign: "center", padding: `0 ${spacing.xxl}px`,
      }}>
        {icon && (
          <div style={{
            width: 72, height: 72, borderRadius: "50%",
            background: `${colors.text.quaternary}20`,
            display: "flex", alignItems: "center", justifyContent: "center",
            marginBottom: spacing.xl, flexShrink: 0,
          }}>
            {icon}
          </div>
        )}
        {title && (
          <h2 style={{
            fontSize: fontSize.heading, fontWeight: fontWeight.bold,
            color: colors.text.primary, margin: 0, marginBottom: spacing.sm,
          }}>
            {title}
          </h2>
        )}
        {subtitle && (
          <p style={{
            fontSize: fontSize.md, color: colors.text.secondary,
            margin: 0, lineHeight: 1.6,
            ...(hint ? { marginBottom: spacing.lg } : {}),
          }}>
            {subtitle}
          </p>
        )}
        {hint && (
          <p style={{
            fontSize: fontSize.sm, color: colors.text.tertiary,
            margin: 0, lineHeight: 1.5,
          }}>
            {hint}
          </p>
        )}
        {children}
      </div>

      {/* Bottom-pinned actions */}
      {actions && (
        <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", gap: spacing.md }}>
          {actions}
        </div>
      )}
    </div>
  );
}
