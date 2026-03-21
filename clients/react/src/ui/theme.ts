// Inject CSS custom properties for light/dark theme.
// Deduped: only injects once even if multiple modules import this file.
if (typeof document !== "undefined" && !document.querySelector("style[data-collapse-theme]")) {
  const style = document.createElement("style");
  style.setAttribute("data-collapse-theme", "");
  style.textContent = `
    :root {
      /* Dark theme (default/fallback) */
      --color-bg-body: #000000;
      --color-bg-panel: #111111;
      --color-modal-backdrop: rgba(0, 0, 0, 0.8);
      --color-bg-surface: rgba(255, 255, 255, 0.05);
      --color-bg-sunken: rgba(255, 255, 255, 0.02);
      --color-text-primary: #ffffff;
      --color-text-inverse: #000000;
      --color-text-secondary: rgba(255, 255, 255, 0.6);
      --color-text-tertiary: rgba(255, 255, 255, 0.4);
      --color-text-quaternary: rgba(255, 255, 255, 0.2);
      --color-text-error: #fca5a5;
      --color-border-default: rgba(255, 255, 255, 0.1);
      --color-border-hover: rgba(255, 255, 255, 0.2);
      --color-bg-selected: rgba(255, 255, 255, 0.08);
      --color-border-selected: rgba(255, 255, 255, 0.3);
      --color-icon-selected: rgba(255, 255, 255, 0.8);
      --color-status-neutral: rgba(255, 255, 255, 0.2);
      --color-spinner-base: rgba(255, 255, 255, 0.1);
      --color-spinner-track: rgba(255, 255, 255, 0.8);
      --color-skeleton-bg: rgba(255, 255, 255, 0.03);
      --color-skeleton-shimmer: rgba(255, 255, 255, 0.08);
      --color-badge-primary-bg: #22c55e26;
      --color-badge-primary-text: #22c55e;
      --color-badge-overlay-bg: rgba(0, 0, 0, 0.7);
      --color-badge-overlay-text: #ffffff;
      --color-archive-bg: rgba(0, 0, 0, 0.6);
      --color-archive-icon: #ffffff;
      --color-archive-border: rgba(255, 255, 255, 0.1);
      --color-archive-hover-bg: rgba(255, 255, 255, 0.1);
      --color-archive-hover-border: rgba(255, 255, 255, 0.2);
    }
    @media (prefers-color-scheme: light) {
      :root {
        --color-bg-body: #ffffff;
        --color-bg-panel: #ffffff;
        --color-modal-backdrop: rgba(255, 255, 255, 0.8);
        --color-bg-surface: rgba(0, 0, 0, 0.05);
        --color-bg-sunken: rgba(0, 0, 0, 0.02);
        --color-text-primary: #000000;
        --color-text-inverse: #ffffff;
        --color-text-secondary: rgba(0, 0, 0, 0.6);
        --color-text-tertiary: rgba(0, 0, 0, 0.4);
        --color-text-quaternary: rgba(0, 0, 0, 0.2);
        --color-text-error: #ef4444;
        --color-border-default: rgba(0, 0, 0, 0.1);
        --color-border-hover: rgba(0, 0, 0, 0.2);
        --color-bg-selected: rgba(0, 0, 0, 0.08);
        --color-border-selected: rgba(0, 0, 0, 0.3);
        --color-icon-selected: rgba(0, 0, 0, 0.8);
        --color-status-neutral: #000000;
        --color-spinner-base: rgba(0, 0, 0, 0.1);
        --color-spinner-track: rgba(0, 0, 0, 0.8);
        --color-skeleton-bg: rgba(0, 0, 0, 0.05);
        --color-skeleton-shimmer: rgba(0, 0, 0, 0.08);
        --color-badge-primary-bg: #22c55e;
        --color-badge-primary-text: #ffffff;
        --color-badge-overlay-bg: #000000;
        --color-badge-overlay-text: #ffffff;
        --color-archive-bg: rgba(255, 255, 255, 0.9);
        --color-archive-icon: #000000;
        --color-archive-border: rgba(0, 0, 0, 0.1);
        --color-archive-hover-bg: rgba(255, 255, 255, 1);
        --color-archive-hover-border: rgba(0, 0, 0, 0.2);
      }
    }`;
  document.head.appendChild(style);
}

export const colors = {
  bg: { body: "var(--color-bg-body)", panel: "var(--color-bg-panel)", backdrop: "var(--color-modal-backdrop)", surface: "var(--color-bg-surface)", sunken: "var(--color-bg-sunken)", selected: "var(--color-bg-selected)" },
  text: { primary: "var(--color-text-primary)", inverse: "var(--color-text-inverse)", secondary: "var(--color-text-secondary)", tertiary: "var(--color-text-tertiary)", quaternary: "var(--color-text-quaternary)", error: "var(--color-text-error)" },
  border: { default: "var(--color-border-default)", hover: "var(--color-border-hover)", selected: "var(--color-border-selected)" },
  icon: { selected: "var(--color-icon-selected)" },
  spinner: { base: "var(--color-spinner-base)", track: "var(--color-spinner-track)" },
  skeleton: { bg: "var(--color-skeleton-bg)", shimmer: "var(--color-skeleton-shimmer)" },
  badge: { 
    primaryBg: "var(--color-badge-primary-bg)", 
    primaryText: "var(--color-badge-primary-text)",
    overlayBg: "var(--color-badge-overlay-bg)",
    overlayText: "var(--color-badge-overlay-text)",
  },
  status: {
    success: "#22c55e",
    info: "#3b82f6",
    warning: "#f59e0b",
    danger: "#ef4444",
    neutral: "var(--color-status-neutral)",
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
