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

  // Effect 1: Sync baseRef with server value.
  // Normally ratchets forward (never backward) for smooth display.
  // But if the display has drifted more than 3 minutes ahead of the server
  // (e.g. captures were failing while the timer kept interpolating),
  // snap back to the server value to correct the drift.
  const DRIFT_CORRECTION_THRESHOLD = 180; // 3 minutes
  useEffect(() => {
    const drift = baseRef.current - serverTrackedSeconds;
    let newBase: number;
    if (drift > DRIFT_CORRECTION_THRESHOLD) {
      // Display is way ahead of reality — snap to server value
      newBase = serverTrackedSeconds;
    } else {
      newBase = Math.max(baseRef.current, serverTrackedSeconds);
    }
    if (newBase !== baseRef.current) {
      baseRef.current = newBase;
      setDisplaySeconds(newBase);
      lastSyncRef.current = Date.now();
    }
  }, [serverTrackedSeconds]);

  // Effect 2: RAF-driven display interpolation.
  // On activation: reset time anchor so pause duration isn't counted.
  // On deactivation (cleanup): snapshot base+elapsed into baseRef to preserve
  // the display value and prevent backward jumps on resume.
  useEffect(() => {
    if (!isActive) return;

    lastSyncRef.current = Date.now();

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
    return () => {
      cancelAnimationFrame(raf);
      baseRef.current += Math.floor((Date.now() - lastSyncRef.current) / 1000);
      lastSyncRef.current = Date.now();
    };
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
