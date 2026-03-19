import React from "react";
import { colors, radii } from "./theme.js";

export interface CardProps {
  children: React.ReactNode;
  onClick?: () => void;
  padding?: number | string;
  style?: React.CSSProperties;
}

export function Card({ children, onClick, padding, style }: CardProps) {
  return (
    <div
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      style={{
        background: colors.bg.surface,
        border: `1px solid ${colors.border.default}`,
        borderRadius: radii.lg,
        overflow: "hidden",
        cursor: onClick ? "pointer" : undefined,
        transition: "border-color 0.15s",
        padding,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
