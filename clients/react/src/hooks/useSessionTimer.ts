import { useState, useEffect, useRef } from "react";

/**
 * Client-side interpolated timer. Uses server-provided trackedSeconds
 * as ground truth, interpolates between updates for smooth display.
 *
 * The server already accounts for the first screenshot at t=0 by using
 * (count(distinct minute_buckets) - 1) * 60, so no client-side offset
 * is needed.
 */
export function useSessionTimer(
  serverTrackedSeconds: number,
  isActive: boolean,
): number {
  const [displaySeconds, setDisplaySeconds] = useState(serverTrackedSeconds);
  const lastSyncRef = useRef(Date.now());
  // Base value the RAF tick counts from. Ratchets up so display never jumps backward.
  const baseRef = useRef(serverTrackedSeconds);
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;

  // Max forward jump (seconds) before we let the timer catch up naturally.
  // Prevents visible jumps when the server adds a full bucket (e.g. +60s)
  // but only a few seconds have actually elapsed since resume.
  const SNAP_THRESHOLD = 3;

  useEffect(() => {
    if (!isActiveRef.current) {
      // Timer isn't ticking — accept server value directly as new base.
      // No visible jump because the display is static.
      baseRef.current = Math.max(baseRef.current, serverTrackedSeconds);
      setDisplaySeconds(baseRef.current);
      lastSyncRef.current = Date.now();
      return;
    }

    const currentDisplay = baseRef.current + Math.floor((Date.now() - lastSyncRef.current) / 1000);

    if (serverTrackedSeconds <= currentDisplay) {
      // Server is behind or equal — keep current base (prevents backward snap).
      return;
    }

    if (serverTrackedSeconds - currentDisplay <= SNAP_THRESHOLD) {
      // Server is slightly ahead — snap to it (normal sync).
      baseRef.current = serverTrackedSeconds;
      setDisplaySeconds(baseRef.current);
      lastSyncRef.current = Date.now();
    }
    // Server is way ahead — don't snap. The RAF tick will count up
    // naturally and reach the server value on its own.
  }, [serverTrackedSeconds]);

  useEffect(() => {
    if (!isActive) return;
    let raf: number;
    let lastRenderedSecond = -1;
    const tick = () => {
      const elapsed = Math.floor((Date.now() - lastSyncRef.current) / 1000);
      if (elapsed !== lastRenderedSecond) {
        lastRenderedSecond = elapsed;
        setDisplaySeconds(baseRef.current + elapsed);
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
