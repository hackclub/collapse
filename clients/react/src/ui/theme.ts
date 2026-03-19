export const colors = {
  bg: { body: "#0a0a0a", surface: "#1a1a1a", sunken: "#111" },
  text: { primary: "#fff", secondary: "#888", tertiary: "#666", quaternary: "#555", error: "#fca5a5" },
  border: { default: "#333", hover: "#444" },
  status: {
    success: "#22c55e",
    info: "#3b82f6",
    warning: "#f59e0b",
    danger: "#ef4444",
    neutral: "#888",
  },
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const;
export const radii = { sm: 6, md: 8, lg: 10 } as const;
export const fontSize = { xs: 11, sm: 12, md: 13, lg: 14, xl: 16, xxl: 18, heading: 20, display: 24, timer: 32 } as const;
export const fontWeight = { normal: 400, medium: 500, semibold: 600, bold: 700 } as const;

// Unified status config - replaces duplicates in SessionCard and SessionDetail
export const statusConfig: Record<string, { label: string; color: string }> = {
  pending: { label: "Pending", color: colors.status.neutral },
  active: { label: "Recording", color: colors.status.success },
  paused: { label: "Paused", color: colors.status.warning },
  stopped: { label: "Processing", color: colors.status.info },
  compiling: { label: "Compiling", color: colors.status.info },
  complete: { label: "Complete", color: colors.status.success },
  failed: { label: "Failed", color: colors.status.danger },
};
