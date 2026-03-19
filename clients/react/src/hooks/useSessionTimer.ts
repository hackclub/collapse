import { useState, useEffect, useRef } from "react";
import { SCREENSHOT_INTERVAL_MS } from "@collapse/shared";

const INTERVAL_S = SCREENSHOT_INTERVAL_MS / 1000;

/**
 * Client-side interpolated timer. Uses server-provided trackedSeconds
 * as ground truth, interpolates between updates for smooth display.
 *
 * Subtracts one capture interval because the first screenshot fires at t=0
 * (before any real time has elapsed), so the server's trackedSeconds is
 * always one interval ahead of wall-clock time. Capped at 0.
 */
export function useSessionTimer(
  serverTrackedSeconds: number,
  isActive: boolean,
): number {
  const [displaySeconds, setDisplaySeconds] = useState(
    Math.max(0, serverTrackedSeconds - INTERVAL_S),
  );
  const lastSyncRef = useRef(Date.now());

  useEffect(() => {
    setDisplaySeconds(Math.max(0, serverTrackedSeconds - INTERVAL_S));
    lastSyncRef.current = Date.now();
  }, [serverTrackedSeconds]);

  useEffect(() => {
    if (!isActive) return;
    let raf: number;
    let lastRenderedSecond = -1;
    const tick = () => {
      const elapsed = Math.floor((Date.now() - lastSyncRef.current) / 1000);
      if (elapsed !== lastRenderedSecond) {
        lastRenderedSecond = elapsed;
        setDisplaySeconds(Math.max(0, serverTrackedSeconds - INTERVAL_S + elapsed));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isActive, serverTrackedSeconds]);

  return displaySeconds;
}

/** Format seconds as H:MM:SS or M:SS (for live timer display). */
export function formatTime(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Format seconds as human-readable tracked time (e.g. "1h 34min", "12min", "< 1min"). */
export function formatTrackedTime(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h > 0 && m > 0) return `${h}h ${m}min`;
  if (h > 0) return `${h}h`;
  if (m > 0) return `${m}min`;
  return "< 1min";
}
