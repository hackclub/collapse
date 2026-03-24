import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "../logger.js";
import { SCREENSHOT_INTERVAL_MS, MAX_WIDTH, MAX_HEIGHT, JPEG_QUALITY } from "@lookout/shared";

/** Race a promise against a timeout. Rejects with a clear message if the timeout fires first. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms),
    ),
  ]);
}

const CAPTURE_TIMEOUT_MS = 45_000; // 45s — well under the 60s capture interval

export interface CaptureSource {
  type: "monitor" | "window" | "camera" | "pipewire";
  id: number | string; // number for monitor/window/pipewire, string (deviceId) for camera
}

interface CaptureUploadResult {
  confirmed: boolean;
  trackedSeconds: number;
  nextExpectedAt: string;
  previewBase64: string;
  previewWidth: number;
  previewHeight: number;
}

/** Capture a single frame from a camera, returned as base64 JPEG. */
export type CameraFrameCapture = () => Promise<{
  base64: string;
  width: number;
  height: number;
} | null>;

/**
 * Desktop-native capture hook. Uses Tauri IPC to:
 * 1. Take a native screenshot via xcap (Rust) — or grab a camera frame via the provided callback
 * 2. Upload directly from Rust (no CORS)
 * 3. Confirm with the server
 * 4. Return the captured frame as a preview URL
 */
export function useNativeCapture(
  token: string,
  apiBaseUrl: string,
  sources: CaptureSource[],
  /** For camera sources: a callback that grabs a JPEG frame from the active stream. */
  cameraCapture?: CameraFrameCapture,
  /** Called when the capture loop discovers the server moved the session to a terminal state. */
  onSessionTerminated?: (status: string) => void,
) {
  const [isCapturing, setIsCapturing] = useState(false);
  const [trackedSeconds, setTrackedSeconds] = useState(0);
  const [screenshotCount, setScreenshotCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [lastScreenshotUrl, setLastScreenshotUrl] = useState<string | null>(null);
  const [lastCaptureAt, setLastCaptureAt] = useState<number | null>(null);

  const configuredRef = useRef(false);
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;

  // Track whether we're actively capturing so in-flight requests can
  // check if the user intentionally stopped (avoids auto-resume race).
  const capturingRef = useRef(false);

  // Track blob URL for cleanup
  const blobUrlRef = useRef<string | null>(null);

  // Keep cameraCapture in a ref so captureOnce always sees the latest version
  const cameraCaptureRef = useRef(cameraCapture);
  cameraCaptureRef.current = cameraCapture;

  // Keep onSessionTerminated in a ref for stable closure access
  const onSessionTerminatedRef = useRef(onSessionTerminated);
  onSessionTerminatedRef.current = onSessionTerminated;

  const captureOnce = useCallback(async () => {
    const s = sourcesRef.current;
    if (s.length === 0) return;
    console.log(`[capture] starting capture for ${s.length} sources`);
    try {
      let result: CaptureUploadResult;

      // Camera sources use a browser-side frame capture + Rust upload
      const isCamera = s.length === 1 && s[0].type === "camera";
      if (isCamera) {
        const captureFn = cameraCaptureRef.current;
        if (!captureFn) {
          console.warn("[capture] camera source but no captureFrame callback provided, skipping");
          return;
        }
        const frame = await captureFn();
        if (!frame) {
          console.warn("[capture] camera frame capture returned null, skipping this interval");
          return;
        }
        console.log(`[capture] camera frame captured ${frame.width}x${frame.height} (${Math.round(frame.base64.length * 3 / 4 / 1024)}KB)`);
        result = await withTimeout(
          invoke<CaptureUploadResult>("upload_frame", {
            base64: frame.base64,
            width: frame.width,
            height: frame.height,
          }),
          CAPTURE_TIMEOUT_MS,
          "upload_frame",
        );
      } else {
        // Screen/window: full capture+upload pipeline in Rust (supports multi-source stitching)
        result = await withTimeout(
          invoke<CaptureUploadResult>("capture_and_upload", {
            sources: s,
            maxWidth: MAX_WIDTH,
            maxHeight: MAX_HEIGHT,
            jpegQuality: Math.round(JPEG_QUALITY * 100),
          }),
          CAPTURE_TIMEOUT_MS,
          "capture_and_upload",
        );
      }

      setTrackedSeconds(result.trackedSeconds);
      setLastCaptureAt(Date.now());
      setScreenshotCount((c) => {
        const n = c + 1;
        console.log(`[capture] screenshot #${n} done, tracked: ${result.trackedSeconds}s, next at: ${result.nextExpectedAt}`);
        return n;
      });
      setError(null);

      // Convert preview base64 to blob URL for display
      if (result.previewBase64) {
        const bytes = Uint8Array.from(atob(result.previewBase64), (c) => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: "image/jpeg" });
        const url = URL.createObjectURL(blob);
        if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = url;
        setLastScreenshotUrl(url);
      }
      console.log(`[capture] next capture in ${SCREENSHOT_INTERVAL_MS / 1000}s`);
    } catch (err) {
      const msg = err instanceof Error
        ? err.message + (err.stack ? "\n" + err.stack : "")
        : String(err);
      console.error(`[capture] capture failed: ${msg}`);
      setError(msg);

      // Check if the server paused the session (e.g., stale lastScreenshotAt
      // triggered the cron auto-pause, causing upload rejections).
      // Only auto-resume if we're still actively capturing — if the user
      // intentionally paused/stopped, isCapturing will be false and we must
      // NOT resume (otherwise the server stays "active" while the client
      // thinks it's paused, leading to eventual auto-stop by the cron).
      if (!capturingRef.current) {
        console.log("[capture] capture stopped during in-flight request, skipping auto-resume");
        return;
      }
      try {
        const res = await fetch(`${apiBaseUrl}/api/sessions/${token}/status`);
        if (res.ok) {
          const data = await res.json();
          if (data.status === "paused") {
            // Double-check we're still capturing — user may have paused
            // between the fetch and here.
            if (!capturingRef.current) {
              console.log("[capture] user paused during status check, skipping auto-resume");
              return;
            }
            await fetch(`${apiBaseUrl}/api/sessions/${token}/resume`, { method: "POST" });
            console.log("[capture] session auto-resumed after capture failure");
            setError(null);
          } else if (data.status !== "active" && data.status !== "pending") {
            console.warn(`[capture] session is ${data.status}, stopping capture`);
            setIsCapturing(false);
            onSessionTerminatedRef.current?.(data.status);
          }
        }
      } catch {
        // Best-effort — next tick will retry
      }
    }
  }, [apiBaseUrl, token]);

  // Keep captureOnce in a ref so the interval always calls the latest version
  const captureRef = useRef(captureOnce);
  captureRef.current = captureOnce;

  // The capture loop: one effect manages the entire interval lifecycle.
  // Starts when isCapturing becomes true, stops when it becomes false.
  // Detects sleep by comparing elapsed time between ticks — if the gap is
  // much longer than the interval, the machine slept and we auto-resume.
  // Uses a busy guard to prevent overlapping captures (camera uploads can
  // take longer than the interval).
  useEffect(() => {
    if (!isCapturing) return;

    let lastTick = Date.now();
    let busy = false;
    const SLEEP_THRESHOLD = SCREENSHOT_INTERVAL_MS * 2.5;

    const tick = async () => {
      if (busy) {
        console.debug("[capture] previous capture still in progress, skipping tick");
        return;
      }

      const now = Date.now();
      const elapsed = now - lastTick;
      lastTick = now;

      if (elapsed > SLEEP_THRESHOLD) {
        console.warn(`[capture] detected sleep (gap: ${Math.round(elapsed / 1000)}s), checking session status...`);
        try {
          const res = await fetch(`${apiBaseUrl}/api/sessions/${token}/status`);
          if (res.ok) {
            const data = await res.json();
            console.log(`[capture] session status after sleep: ${data.status}`);
            // Reset timer to server value so it doesn't interpolate the sleep gap
            if (typeof data.trackedSeconds === "number") {
              setTrackedSeconds(data.trackedSeconds);
            }
            if (data.status === "paused") {
              await fetch(`${apiBaseUrl}/api/sessions/${token}/resume`, { method: "POST" });
              console.log("[capture] session resumed after sleep");
            } else if (data.status !== "active" && data.status !== "pending") {
              console.warn(`[capture] session is ${data.status}, stopping capture`);
              capturingRef.current = false;
              setIsCapturing(false);
              onSessionTerminatedRef.current?.(data.status);
              return;
            }
          }
        } catch (e) {
          console.error("[capture] sleep recovery failed:", e);
        }
      }

      busy = true;
      try {
        await captureRef.current();
      } finally {
        busy = false;
      }
    };

    console.log(`[capture] capture loop started, interval: ${SCREENSHOT_INTERVAL_MS}ms`);
    tick();
    const id = setInterval(tick, SCREENSHOT_INTERVAL_MS);
    return () => {
      console.log("[capture] capture loop stopped");
      clearInterval(id);
    };
  }, [isCapturing, apiBaseUrl, token]);

  // Clean up blob URL on unmount
  useEffect(() => {
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, []);

  const startCapturing = useCallback(async () => {
    if (!configuredRef.current) {
      console.log(`[capture] configuring with token: ${token.slice(0, 8)}...`);
      await invoke("configure", { token, apiBaseUrl });
      configuredRef.current = true;
    }
    console.log("[capture] starting capture");
    capturingRef.current = true;
    setIsCapturing(true);
    setError(null);
  }, [token, apiBaseUrl]);

  const stopCapturing = useCallback(() => {
    console.log("[capture] stopping capture");
    capturingRef.current = false;
    setIsCapturing(false);
  }, []);

  return {
    isCapturing,
    trackedSeconds,
    screenshotCount,
    error,
    lastScreenshotUrl,
    lastCaptureAt,
    startCapturing,
    stopCapturing,
  };
}
