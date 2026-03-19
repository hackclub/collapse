import React from "react";
import { statusConfig, fontSize, fontWeight } from "./theme.js";

export interface BadgeProps {
  status: string;
  variant?: "overlay" | "inline";
}

export function Badge({ status, variant = "overlay" }: BadgeProps) {
  const config = statusConfig[status] ?? { label: status, color: "#888" };
  const isOverlay = variant === "overlay";
  return (
    <span style={{
      fontSize: fontSize.xs - 1,  // 10px
      fontWeight: fontWeight.semibold,
      color: config.color,
      padding: "2px 8px",
      borderRadius: 4,
      ...(isOverlay
        ? { background: "rgba(0,0,0,0.7)", border: `1px solid ${config.color}` }
        : { background: `${config.color}15` }),
    }}>
      {config.label}
    </span>
  );
}
