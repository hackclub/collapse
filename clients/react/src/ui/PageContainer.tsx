import React from "react";
import { spacing } from "./theme.js";

export interface PageContainerProps {
  children: React.ReactNode;
  maxWidth?: number;
  centered?: boolean;
  style?: React.CSSProperties;
}

export function PageContainer({ children, maxWidth = 640, centered = false, style }: PageContainerProps) {
  return (
    <div style={{
      maxWidth,
      margin: "0 auto",
      padding: spacing.lg,
      ...(centered ? {
        display: "flex",
        flexDirection: "column" as const,
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
      } : {}),
      ...style,
    }}>
      {children}
    </div>
  );
}
