import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "../logger.js";
import { isGlassSupported, setLiquidGlassEffect, GlassMaterialVariant } from "tauri-plugin-liquid-glass-api";
import { Button, colors, spacing, fontSize, fontWeight } from "@lookout/react";
import NumberFlow from "@number-flow/react";

function TrayTimer({ totalSeconds }: { totalSeconds: number }) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;

  if (h > 0) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center" }}>
        <NumberFlow value={h} />
        <span style={{ margin: "0 1px", position: "relative", top: "-1px" }}>:</span>
        <NumberFlow value={m} format={{ minimumIntegerDigits: 2 }} />
        <span style={{ margin: "0 1px", position: "relative", top: "-1px" }}>:</span>
        <NumberFlow value={s} format={{ minimumIntegerDigits: 2 }} />
      </span>
    );
  }
  return (
    <span style={{ display: "inline-flex", alignItems: "center" }}>
      <NumberFlow value={m} format={{ minimumIntegerDigits: 2 }} />
      <span style={{ margin: "0 1px", position: "relative", top: "-1px" }}>:</span>
      <NumberFlow value={s} format={{ minimumIntegerDigits: 2 }} />
    </span>
  );
}

export function TrayApp() {
  const [state, setState] = useState({
    displaySeconds: 0,
    screenshotCount: 0,
    controlMode: "recording" as "recording" | "paused",
    updatedAt: Date.now(),
  });

  const [liveSeconds, setLiveSeconds] = useState(0);

  const [isWindows, setIsWindows] = useState(false);
  const [cornerRadius, setCornerRadius] = useState(10);

  useEffect(() => {
    // Force global transparency for the tray window to ensure native glass shows through
    document.documentElement.style.setProperty('background', 'transparent', 'important');
    document.body.style.setProperty('background', 'transparent', 'important');
    
    // Also explicitly force #root to be transparent
    const root = document.getElementById('root');
    if (root) {
      root.style.setProperty('background', 'transparent', 'important');
    }

    // Check OS for styling fallbacks
    const ua = navigator.userAgent.toLowerCase();
    const windows = ua.includes('windows') || ua.includes('linux');
    setIsWindows(windows);

    const macMatch = navigator.userAgent.match(/Mac OS X (\d+)[._](\d+)/);
    const macMajor = macMatch ? parseInt(macMatch[1], 10) : 0;
    const isTahoe = macMajor >= 26;
    setCornerRadius(isTahoe ? 16 : 10);

    // Apply native glass effects
    async function setupGlass() {
      try {
        const supported = await isGlassSupported();
        console.log("Liquid glass supported:", supported);
        
        await setLiquidGlassEffect({
          cornerRadius: isTahoe ? 16 : 10,
          tintColor: "#00000000",
          variant: GlassMaterialVariant.Sidebar, 
        });
      } catch (e) {
        console.error("Failed to setup liquid glass", e);
      }
    }
    setupGlass();
    
    return () => {
      // Cleanup styles if unmounted (though this is the tray entry point)
      document.documentElement.style.removeProperty('background');
      document.body.style.removeProperty('background');
      if (root) root.style.removeProperty('background');
    };
  }, []);

  // Derive the live real-time seconds ticking up
  useEffect(() => {
    // Immediate sync
    let current = state.displaySeconds;
    if (state.controlMode === "recording") {
      const elapsed = Math.floor((Date.now() - state.updatedAt) / 1000);
      current += Math.max(0, elapsed);
    }
    setLiveSeconds(current);

    if (state.controlMode !== "recording") return;

    // Tick locally so we don't depend on the asleep main window
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - state.updatedAt) / 1000);
      setLiveSeconds(state.displaySeconds + Math.max(0, elapsed));
    }, 1000);

    return () => clearInterval(interval);
  }, [state]);

  useEffect(() => {
    let unlistenState: (() => void) | undefined;
    let unlistenOpened: (() => void) | undefined;
    
    const syncState = async () => {
      try {
        const backendState = await invoke<any>("get_tray_state");
        setState(backendState);
      } catch (e) {
        console.error("Failed to sync tray state from backend", e);
      }
    };
    
    const setup = async () => {
      // Listen for regular state updates
      unlistenState = await listen<any>("tray-state", (event) => {
        setState(event.payload);
      });
      
      // When the tray window is opened, explicitly request the latest state
      unlistenOpened = await listen<any>("tray-opened", syncState);
      
      // Request initial state on first mount
      syncState();
    };
    
    setup().catch((e) => {
      console.error("Failed to set up tray listeners", e);
    });
    
    // Also sync on window focus just in case
    window.addEventListener("focus", syncState);
    
    return () => {
      if (unlistenState) unlistenState();
      if (unlistenOpened) unlistenOpened();
      window.removeEventListener("focus", syncState);
    };
  }, []);

  const handlePause = () => {
    invoke("tray_action", { action: "pause" });
  };

  const handleResume = () => {
    invoke("tray_action", { action: "resume" });
  };

  const handleStop = () => {
    invoke("tray_action", { action: "stop" });
  };

  return (
    <>
      <style>{`
        /* Force absolute transparency on all root elements for macOS */
        :root, html, body, #root {
          background: transparent !important;
          background-color: transparent !important;
        }
        /* Override the Lookout theme variables just for the tray */
        :root {
          --color-bg-body: transparent !important;
          --color-bg-panel: transparent !important;
        }
      `}</style>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: `${spacing.sm}px ${spacing.md}px`,
        width: "100%", height: "100%", boxSizing: "border-box",
        fontFamily: "system-ui, -apple-system, sans-serif",
        backgroundColor: isWindows ? "rgba(26, 26, 26, 0.93)" : "transparent",
        borderRadius: isWindows ? 0 : cornerRadius,
        border: "none",
        overflow: "hidden", // Ensure content doesn't bleed past the rounded corners
        /* Explicitly add a border-radius here that matches cornerRadius */
        WebkitBorderRadius: isWindows ? 0 : cornerRadius,
      }}>
      <div style={{ display: "flex", alignItems: "center", gap: spacing.md }}>
        <div style={{ display: "flex", alignItems: "center", gap: spacing.sm }}>
          {state.controlMode === "recording" && (
            <div style={{
              width: 8, height: 8, borderRadius: "50%", background: colors.status.danger,
              animation: "pulse 1.5s ease-in-out infinite", flexShrink: 0,
            }} />
          )}
          {state.controlMode === "paused" && (
            <span style={{ color: colors.text.tertiary, flexShrink: 0, lineHeight: 1, display: "inline-flex", alignItems: "center" }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <rect x="7" y="5" width="4" height="14" rx="1" />
                <rect x="13" y="5" width="4" height="14" rx="1" />
              </svg>
            </span>
          )}
          <span style={{
            fontSize: fontSize.md,
            fontWeight: fontWeight.bold,
            fontVariantNumeric: "tabular-nums",
            color: colors.text.primary,
            display: "flex"
          }}>
            <TrayTimer totalSeconds={liveSeconds} />
          </span>
        </div>
        <span style={{ fontSize: fontSize.sm, color: colors.text.secondary }}>
          {state.screenshotCount} {state.screenshotCount === 1 ? "shot" : "shots"}
        </span>
      </div>

      <div style={{ display: "flex", gap: spacing.xs }}>
        {state.controlMode === "recording" ? (
          <Button variant="warning" size="sm" onClick={handlePause}>
            Pause
          </Button>
        ) : (
          <Button variant="success" size="sm" onClick={handleResume}>
            Resume
          </Button>
        )}
        <Button variant="danger" size="sm" onClick={handleStop}>
          Stop
        </Button>
      </div>
      </div>
    </>
  );
}
