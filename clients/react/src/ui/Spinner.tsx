import React from "react";
import { colors } from "./theme.js";

export interface SpinnerProps {
  size?: "sm" | "md" | "lg";
  color?: string;
}

const sizes = { sm: 16, md: 24, lg: 40 };
const borders = { sm: 2, md: 3, lg: 4 };

export function Spinner({ size = "md", color = colors.status.info }: SpinnerProps) {
  const s = sizes[size];
  const b = borders[size];
  return (
    <div style={{
      width: s, height: s, borderRadius: "50%",
      border: `${b}px solid ${colors.border.default}`,
      borderTopColor: color,
      animation: "spin 1s linear infinite",
      flexShrink: 0,
    }} />
  );
}
