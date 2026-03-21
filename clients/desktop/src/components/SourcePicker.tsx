import React, { useEffect, useState, useCallback, useRef } from "react";
import { invoke } from "../logger.js";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
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
  const [hoveredWindow, setHoveredWindow] = useState<CaptureSource | null>(null);
  const [hoverAspectRatio, setHoverAspectRatio] = useState(16 / 9);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [showTopMask, setShowTopMask] = useState(false);
  const [showBottomMask, setShowBottomMask] = useState(false);

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setShowTopMask(scrollTop > 0);
    setShowBottomMask(Math.ceil(scrollTop + clientHeight) < scrollHeight);
  }, []);

  // Live preview of currently selected source
  const { previewUrl } = useScreenPreview(selected, 1500);
  const { previewUrl: hoverPreviewUrl } = useScreenPreview(hoveredWindow, 1200, false);

  const refresh = useCallback(async () => {
    console.log("[sources] listing capture sources...");
    try {
      const result = await invoke<CaptureSourceList>("list_capture_sources");
      console.log(`[sources] found ${result.monitors.length} monitors, ${result.windows.length} windows`);
      setSources(result);
      setError(null);
      // Wait for render then check scroll
      setTimeout(handleScroll, 10);

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

  useEffect(() => {
    handleScroll();
    window.addEventListener('resize', handleScroll);
    return () => window.removeEventListener('resize', handleScroll);
  }, [tab, sources, handleScroll]);

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
  const hoverMatchesSelected = !!hoveredWindow && sourcesEqual(hoveredWindow, selected);
  const showHoverPreview = tab === "windows" && hoveredWindow && !hoverMatchesSelected;
  const selectedIsWindow = selected?.type === "window";
  const selectedKey = selected ? `${selected.type}:${selected.id}` : "preview-empty";
  const selectedHandoffLayoutId =
    hoverMatchesSelected && selected?.type === "window"
      ? `hover-to-main-preview-${selected.id}`
      : undefined;
  const hoveredHandoffLayoutId =
    hoveredWindow?.type === "window" ? `hover-to-main-preview-${hoveredWindow.id}` : undefined;
  const previewSrc = selectedIsWindow && hoverMatchesSelected
    ? (hoverPreviewUrl ?? previewUrl)
    : (previewUrl ?? null);

  return (
    <div style={{
      maxWidth: 480,
      margin: "0 auto",
      padding: spacing.lg,
      display: "flex",
      flexDirection: "column",
      height: "100%", // Fill parent RecordPage container
      maxHeight: "100%",
    }}>
      <div style={{ flexShrink: 0 }}>
        <h2 style={{ fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.text.primary, marginBottom: spacing.md, textAlign: "center" }}>
          What should Collapse capture?
        </h2>

        {/* Live preview */}
        <div style={{
          position: "relative",
          borderRadius: radii.lg, overflow: "hidden", background: colors.bg.sunken,
          border: `1px solid ${colors.border.default}`, marginBottom: spacing.lg, aspectRatio: "16/9",
        }}>
          <LayoutGroup id="preview-handoff">
            <AnimatePresence mode="sync" initial={false}>
              {previewSrc ? (
                <motion.img
                  key={selectedKey}
                  src={previewSrc}
                  alt="Preview"
                  layoutId={selectedHandoffLayoutId}
                  initial={{ opacity: 0, scale: selectedIsWindow ? 1.08 : 1.02 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={{
                    opacity: { duration: 0.22, ease: "easeOut" },
                    scale: { type: "spring", stiffness: 360, damping: 32, mass: 0.7 },
                    layout: { type: "spring", stiffness: 420, damping: 34, mass: 0.75 },
                  }}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "contain",
                    display: "block",
                    position: "absolute",
                    inset: 0,
                  }}
                />
              ) : (
                <motion.div
                  key="preview-empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}
                >
                  <p style={{ fontSize: fontSize.md, color: colors.text.quaternary, textAlign: "center" }}>
                    {selected ? "Capturing preview..." : "Select a source below"}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            {showHoverPreview && (
              <motion.div
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ type: "spring", stiffness: 420, damping: 32, mass: 0.7 }}
                style={{
                  position: "absolute",
                  right: spacing.md,
                  top: spacing.xl,
                  width: 240,
                  maxHeight: 180,
                  aspectRatio: String(hoverAspectRatio),
                  borderRadius: radii.md,
                  overflow: "hidden",
                  background: colors.bg.surface,
                  border: `1px solid ${colors.border.default}`,
                  boxShadow: "0 10px 30px rgba(0,0,0,0.22)",
                  pointerEvents: "none",
                  zIndex: 2,
                }}
              >
                {hoverPreviewUrl ? (
                  <motion.img
                    src={hoverPreviewUrl}
                    alt="Window hover preview"
                    layoutId={hoveredHandoffLayoutId}
                    style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
                  />
                ) : (
                  <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <p style={{ fontSize: fontSize.xs, color: colors.text.tertiary }}>Loading preview...</p>
                  </div>
                )}
              </motion.div>
            )}
          </LayoutGroup>
        </div>

        {/* Tabs */}
        {hasWindows && (
          <LayoutGroup>
            <div style={{
              display: "flex", gap: spacing.xs, marginBottom: spacing.md, background: colors.bg.surface,
              borderRadius: radii.md, padding: 4, position: "relative", alignItems: "stretch"
            }}>
              <button
                style={{
                  flex: 1, padding: `6px ${spacing.sm}px`, fontSize: fontSize.sm, fontWeight: tab === "screens" ? fontWeight.semibold : fontWeight.medium,
                  background: "transparent",
                  color: tab === "screens" ? colors.text.primary : colors.text.secondary,
                  border: "none", borderRadius: radii.sm, cursor: "pointer",
                  position: "relative",
                  display: "flex", alignItems: "center", justifyContent: "center"
                }}
                onClick={() => setTab("screens")}
              >
                {tab === "screens" && (
                  <motion.div
                    layoutId="activeTabIndicator"
                    transition={{ type: "spring", stiffness: 350, damping: 35 }}
                    style={{
                      position: "absolute", inset: 0, borderRadius: radii.sm,
                      background: colors.border.default, zIndex: 0,
                    }}
                  />
                )}
                <span style={{ position: "relative", zIndex: 1, display: "inline-block" }}>
                  Screens ({sources.monitors.length})
                </span>
              </button>
              <button
                style={{
                  flex: 1, padding: `6px ${spacing.sm}px`, fontSize: fontSize.sm, fontWeight: tab === "windows" ? fontWeight.semibold : fontWeight.medium,
                  background: "transparent",
                  color: tab === "windows" ? colors.text.primary : colors.text.secondary,
                  border: "none", borderRadius: radii.sm, cursor: "pointer",
                  position: "relative",
                  display: "flex", alignItems: "center", justifyContent: "center"
                }}
                onClick={() => setTab("windows")}
              >
                {tab === "windows" && (
                  <motion.div
                    layoutId="activeTabIndicator"
                    transition={{ type: "spring", stiffness: 350, damping: 35 }}
                    style={{
                      position: "absolute", inset: 0, borderRadius: radii.sm,
                      background: colors.border.default, zIndex: 0,
                    }}
                  />
                )}
                <span style={{ position: "relative", zIndex: 1, display: "inline-block" }}>
                  Windows ({sources.windows.length})
                </span>
              </button>
            </div>
          </LayoutGroup>
        )}
      </div>

      {/* Source list */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        style={{
        display: "flex",
        flexDirection: "column",
        gap: spacing.xs,
        flex: 1, // Let it fill available space
        minHeight: 0, // Critical for nested flex scrolling
        overflowY: "auto",
        // Add a smooth fade out mask at top/bottom of scroll area
        maskImage: `linear-gradient(to bottom, ${showTopMask ? 'transparent 0%, black 12px' : 'black 0%, black 12px'}, ${showBottomMask ? 'black calc(100% - 12px), transparent 100%' : 'black calc(100% - 12px), black 100%'})`,
        WebkitMaskImage: `linear-gradient(to bottom, ${showTopMask ? 'transparent 0%, black 12px' : 'black 0%, black 12px'}, ${showBottomMask ? 'black calc(100% - 12px), transparent 100%' : 'black calc(100% - 12px), black 100%'})`,
        paddingBottom: spacing.xs,
      }}>
        {(tab === "screens" || !hasWindows) &&
          sources.monitors.map((m) => {
            const src: CaptureSource = { type: "monitor", id: m.id };
            const isSelected = sourcesEqual(selected, src);
            return (
              <motion.button
                key={`m-${m.id}`}
                whileTap="active"
                initial="idle"
                style={{
                  display: "flex", alignItems: "center", gap: spacing.md,
                  padding: `${spacing.md}px ${spacing.md}px`, background: "transparent",
                  border: "none",
                  borderRadius: radii.md, cursor: "pointer", textAlign: "left" as const,
                  width: "100%", position: "relative",
                }}
                onClick={() => setSelected(src)}
              >
                <motion.div
                  variants={{ idle: { scale: 1 }, active: { scale: 0.98 } }}
                  transition={{ type: "spring", stiffness: 1500, damping: 60 }}
                  style={{
                    position: "absolute", inset: 0,
                    background: isSelected ? colors.bg.selected : colors.bg.surface,
                    border: `1px solid ${isSelected ? colors.border.selected : colors.border.default}`,
                    borderRadius: radii.md,
                    zIndex: 0,
                  }}
                />
                <div
                  style={{ display: "flex", alignItems: "center", gap: spacing.md, width: "100%", position: "relative", zIndex: 1 }}
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
                          fontSize: fontSize.xs - 1, fontWeight: fontWeight.semibold, color: colors.badge.primaryText,
                          background: colors.badge.primaryBg, padding: "1px 6px", borderRadius: radii.sm,
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
                </div>
              </motion.button>
            );
          })}

        {tab === "windows" && hasWindows &&
          sources.windows.map((w) => {
            const src: CaptureSource = { type: "window", id: w.id };
            const isSelected = sourcesEqual(selected, src);
            return (
              <motion.button
                key={`w-${w.id}`}
                whileTap="active"
                initial="idle"
                style={{
                  display: "flex", alignItems: "center", gap: spacing.md,
                  padding: `${spacing.md}px ${spacing.md}px`, background: "transparent",
                  border: "none",
                  borderRadius: radii.md, cursor: "pointer", textAlign: "left" as const,
                  width: "100%", position: "relative",
                  ...(w.isMinimized ? { opacity: 0.5 } : {}),
                }}
                onClick={() => setSelected(src)}
                onMouseEnter={(e) => {
                  setHoveredWindow(src);
                  const ratio = w.height > 0 ? w.width / w.height : 16 / 9;
                  setHoverAspectRatio(Math.min(3, Math.max(0.5, ratio)));
                }}
                onMouseLeave={() => {
                  setHoveredWindow(null);
                }}
              >
                <motion.div
                  variants={{ idle: { scale: 1 }, active: { scale: 0.98 } }}
                  transition={{ type: "spring", stiffness: 1500, damping: 60 }}
                  style={{
                    position: "absolute", inset: 0,
                    background: isSelected ? colors.bg.selected : colors.bg.surface,
                    border: `1px solid ${isSelected ? colors.border.selected : colors.border.default}`,
                    borderRadius: radii.md,
                    zIndex: 0,
                  }}
                />
                <div
                  style={{ display: "flex", alignItems: "center", gap: spacing.md, width: "100%", position: "relative", zIndex: 1 }}
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
                </div>
              </motion.button>
            );
          })}
      </div>

      {/* Start button */}
      <div style={{ flexShrink: 0 }}>
        {selected && (
          <Button variant="primary" size="lg" fullWidth onClick={() => onSelect(selected)} style={{ marginTop: spacing.lg }}>
            {submitLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
