import React, { useEffect, useState, useCallback } from "react";
import { invoke } from "../logger.js";
import {
  Button,
  ErrorDisplay,
  Spinner,
  colors,
  spacing,
  radii,
  fontSize,
  fontWeight,
} from "@collapse/react";
import type { CaptureSource } from "../hooks/useNativeCapture.js";
import { useScreenPreview } from "../hooks/useScreenPreview.js";

interface MonitorInfo {
  id: number;
  name: string;
  width: number;
  height: number;
  isPrimary: boolean;
  isBuiltin: boolean;
  scaleFactor: number;
}

interface WindowInfo {
  id: number;
  appName: string;
  title: string;
  width: number;
  height: number;
  isMinimized: boolean;
  isFocused: boolean;
}

interface CaptureSourceList {
  monitors: MonitorInfo[];
  windows: WindowInfo[];
}

interface SourcePickerProps {
  onSelect: (source: CaptureSource) => void;
  submitLabel?: string;
}

function sourcesEqual(a: CaptureSource | null, b: CaptureSource | null): boolean {
  if (!a || !b) return false;
  return a.type === b.type && a.id === b.id;
}

export function SourcePicker({ onSelect, submitLabel = "Start Capture" }: SourcePickerProps) {
  const [sources, setSources] = useState<CaptureSourceList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"screens" | "windows">("screens");
  const [selected, setSelected] = useState<CaptureSource | null>(null);

  // Live preview of currently selected source
  const { previewUrl } = useScreenPreview(selected, 1500);

  const refresh = useCallback(async () => {
    console.log("[sources] listing capture sources...");
    try {
      const result = await invoke<CaptureSourceList>("list_capture_sources");
      console.log(`[sources] found ${result.monitors.length} monitors, ${result.windows.length} windows`);
      setSources(result);
      setError(null);

      // Auto-select primary monitor if nothing selected yet
      if (!selected) {
        const primary = result.monitors.find((m) => m.isPrimary) ?? result.monitors[0];
        if (primary) {
          console.log(`[sources] auto-selected: monitor id=${primary.id} (${primary.name})`);
          setSelected({ type: "monitor", id: primary.id });
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[sources] failed to list sources: ${msg}`);
      setError(msg);
    }
  }, [selected]);

  useEffect(() => { refresh(); }, [refresh]);

  if (error) {
    return (
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", minHeight: 200, padding: spacing.xxl,
      }}>
        <ErrorDisplay
          variant="page"
          title="Failed to detect displays"
          error={error}
          action={{ label: "Retry", onClick: refresh }}
        />
      </div>
    );
  }

  if (!sources) {
    return (
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", minHeight: 200, padding: spacing.xxl, gap: spacing.md,
      }}>
        <Spinner size="md" />
        <p style={{ fontSize: fontSize.lg, color: colors.text.secondary, textAlign: "center" }}>
          Detecting displays...
        </p>
      </div>
    );
  }

  const hasWindows = sources.windows.length > 0;

  return (
    <div style={{ maxWidth: 480, margin: "0 auto", padding: spacing.lg, display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <h2 style={{ fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.text.primary, marginBottom: spacing.md, textAlign: "center" }}>
        What should Collapse capture?
      </h2>

      {/* Live preview */}
      <div style={{
        borderRadius: radii.lg, overflow: "hidden", background: colors.bg.sunken,
        border: `1px solid ${colors.border.default}`, marginBottom: spacing.lg, aspectRatio: "16/9",
      }}>
        {previewUrl ? (
          <img src={previewUrl} alt="Preview" style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />
        ) : (
          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <p style={{ fontSize: fontSize.md, color: colors.text.quaternary, textAlign: "center" }}>
              {selected ? "Capturing preview..." : "Select a source below"}
            </p>
          </div>
        )}
      </div>

      {/* Tabs */}
      {hasWindows && (
        <div style={{
          display: "flex", gap: spacing.xs, marginBottom: spacing.md, background: colors.bg.surface,
          borderRadius: radii.md, padding: spacing.xs,
        }}>
          <button
            style={{
              flex: 1, padding: `7px ${spacing.md}px`, fontSize: fontSize.sm, fontWeight: tab === "screens" ? fontWeight.semibold : fontWeight.medium,
              background: tab === "screens" ? colors.border.default : "transparent",
              color: tab === "screens" ? colors.text.primary : colors.text.secondary,
              border: "none", borderRadius: radii.sm, cursor: "pointer",
            }}
            onClick={() => setTab("screens")}
          >
            Screens ({sources.monitors.length})
          </button>
          <button
            style={{
              flex: 1, padding: `7px ${spacing.md}px`, fontSize: fontSize.sm, fontWeight: tab === "windows" ? fontWeight.semibold : fontWeight.medium,
              background: tab === "windows" ? colors.border.default : "transparent",
              color: tab === "windows" ? colors.text.primary : colors.text.secondary,
              border: "none", borderRadius: radii.sm, cursor: "pointer",
            }}
            onClick={() => setTab("windows")}
          >
            Windows ({sources.windows.length})
          </button>
          <Button variant="ghost" size="sm" onClick={refresh} title="Refresh" style={{ padding: `7px ${spacing.md}px`, fontSize: fontSize.lg }}>
            &#x21bb;
          </Button>
        </div>
      )}

      {/* Source list */}
      <div style={{ display: "flex", flexDirection: "column", gap: spacing.xs, flex: 1, minHeight: 0, overflowY: "auto" }}>
        {(tab === "screens" || !hasWindows) &&
          sources.monitors.map((m) => {
            const src: CaptureSource = { type: "monitor", id: m.id };
            const isSelected = sourcesEqual(selected, src);
            return (
              <button
                key={`m-${m.id}`}
                style={{
                  display: "flex", alignItems: "center", gap: spacing.md,
                  padding: `${spacing.md}px ${spacing.md}px`, background: isSelected ? colors.bg.selected : colors.bg.surface,
                  border: `1px solid ${isSelected ? colors.border.selected : colors.border.default}`,
                  borderRadius: radii.md, cursor: "pointer", textAlign: "left" as const,
                  width: "100%", transition: "border-color 0.15s",
                }}
                onClick={() => setSelected(src)}
              >
                <div style={{
                  width: 18, height: 18, borderRadius: "50%",
                  border: `2px solid ${isSelected ? colors.icon.selected : colors.text.quaternary}`,
                  flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {isSelected && <div style={{ width: 8, height: 8, borderRadius: "50%", background: colors.icon.selected }} />}
                </div>
                <div style={{ flex: 1, display: "flex", flexDirection: "column" as const, gap: 2, minWidth: 0 }}>
                  <span style={{ fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text.primary, display: "flex", alignItems: "center", gap: spacing.sm }}>
                    {m.name}
                    {m.isPrimary && (
                      <span style={{
                        fontSize: fontSize.xs - 1, fontWeight: fontWeight.semibold, color: colors.status.success,
                        background: `${colors.status.success}26`, padding: "1px 6px", borderRadius: radii.sm,
                      }}>
                        Primary
                      </span>
                    )}
                  </span>
                  <span style={{ fontSize: fontSize.xs, color: colors.text.tertiary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                    {m.width}x{m.height}
                    {m.scaleFactor > 1 && ` @ ${m.scaleFactor}x`}
                  </span>
                </div>
              </button>
            );
          })}

        {tab === "windows" && hasWindows &&
          sources.windows.map((w) => {
            const src: CaptureSource = { type: "window", id: w.id };
            const isSelected = sourcesEqual(selected, src);
            return (
              <button
                key={`w-${w.id}`}
                style={{
                  display: "flex", alignItems: "center", gap: spacing.md,
                  padding: `${spacing.md}px ${spacing.md}px`, background: isSelected ? colors.bg.selected : colors.bg.surface,
                  border: `1px solid ${isSelected ? colors.border.selected : colors.border.default}`,
                  borderRadius: radii.md, cursor: "pointer", textAlign: "left" as const,
                  width: "100%", transition: "border-color 0.15s",
                  ...(w.isMinimized ? { opacity: 0.5 } : {}),
                }}
                onClick={() => setSelected(src)}
              >
                <div style={{
                  width: 18, height: 18, borderRadius: "50%",
                  border: `2px solid ${isSelected ? colors.icon.selected : colors.text.quaternary}`,
                  flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {isSelected && <div style={{ width: 8, height: 8, borderRadius: "50%", background: colors.icon.selected }} />}
                </div>
                <div style={{ flex: 1, display: "flex", flexDirection: "column" as const, gap: 2, minWidth: 0 }}>
                  <span style={{ fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text.primary, display: "flex", alignItems: "center", gap: spacing.sm }}>
                    {w.appName || w.title}
                    {w.isMinimized && (
                      <span style={{
                        fontSize: fontSize.xs - 1, fontWeight: fontWeight.medium, color: colors.text.secondary,
                        background: `${colors.text.secondary}26`, padding: "1px 6px", borderRadius: radii.sm,
                      }}>
                        Minimized
                      </span>
                    )}
                  </span>
                  <span style={{ fontSize: fontSize.xs, color: colors.text.tertiary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                    {w.title && w.appName ? w.title + " \u2014 " : ""}
                    {w.width}x{w.height}
                  </span>
                </div>
              </button>
            );
          })}
      </div>

      {/* Start button */}
      {selected && (
        <Button variant="primary" size="lg" fullWidth onClick={() => onSelect(selected)} style={{ marginTop: spacing.lg }}>
          {submitLabel}
        </Button>
      )}
    </div>
  );
}
