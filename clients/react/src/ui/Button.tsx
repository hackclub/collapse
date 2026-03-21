import React from "react";
import { motion } from "motion/react";
import { colors, radii, fontWeight } from "./theme.js";
import { Spinner } from "./Spinner.js";

import { Squircle } from "@squircle-js/react";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "success" | "danger" | "warning" | "secondary" | "ghost";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  fullWidth?: boolean;
}

const variantStyles: Record<string, React.CSSProperties> = {
  primary: { background: colors.status.info, color: "#fff", border: "1px solid transparent" },
  success: { background: colors.status.success, color: "#fff", border: "1px solid transparent" },
  danger: { background: colors.status.danger, color: "#fff", border: "1px solid transparent" },
  warning: { background: colors.status.warning, color: "#000", border: "1px solid transparent" },
  secondary: { background: "transparent", color: colors.text.secondary, border: `1px solid ${colors.border.hover}` },
  ghost: { background: "transparent", color: colors.text.secondary, border: "1px solid transparent" },
};

const sizeStyles: Record<string, React.CSSProperties> = {
  sm: { padding: "6px 12px", fontSize: 12 },
  md: { padding: "8px 16px", fontSize: 13 },
  lg: { padding: "12px 24px", fontSize: 15 },
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  fullWidth = false,
  disabled,
  children,
  style,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;
  
  // Extract presentation styles to apply to the inner div so they don't get overridden or ignored
  const { background, border, borderRadius, color, ...outerStyle } = (style as React.CSSProperties) || {};
  const idleBackground = background ?? variantStyles[variant].background;
  const idleBorder = border ?? variantStyles[variant].border;
  const hoverBackground =
    background ?? (variant === "ghost" ? colors.bg.selected : variant === "secondary" ? colors.bg.surface : variantStyles[variant].background);
  const hoverBorder =
    border ?? (variant === "ghost" ? "1px solid transparent" : variantStyles[variant].border);

  return (
    <motion.button
      whileHover={isDisabled ? undefined : "hover"}
      whileTap={isDisabled ? undefined : "active"}
      initial="idle"
      disabled={isDisabled}
      style={{
        position: "relative",
        fontWeight: fontWeight.semibold,
        borderRadius: borderRadius ?? radii.md,
        cursor: isDisabled ? "not-allowed" : "pointer",
        opacity: isDisabled ? 0.6 : 1,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: fullWidth ? "100%" : undefined,
        padding: 0,
        color: color ?? variantStyles[variant].color,
        background: "transparent",
        border: "1px solid transparent",
        ...outerStyle,
      }}
      {...(rest as any)}
    >
      <Squircle cornerRadius={(borderRadius as number) ?? radii.md} cornerSmoothing={0.7} asChild>
        <motion.div
          variants={{
            idle: { scale: 1, background: idleBackground, border: idleBorder },
            hover: { scale: 1, background: hoverBackground, border: hoverBorder },
            active: { scale: 0.96, background: hoverBackground, border: hoverBorder },
          }}
          transition={{ type: "spring", stiffness: 1500, damping: 60 }}
          style={{
            position: "absolute",
            inset: -1,
            background: idleBackground,
            border: idleBorder,
            transition: "opacity 0.15s, background 0.15s, border-color 0.15s",
          }}
        />
      </Squircle>
      <span
        style={{
          position: "relative",
          zIndex: 1,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          width: "100%",
          ...sizeStyles[size],
        }}
      >
        {loading && <Spinner size="sm" color={variant === "warning" ? "#000" : "#fff"} />}
        {children}
      </span>
    </motion.button>
  );
}
