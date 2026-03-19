import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SCREENSHOT_INTERVAL_MS, MAX_WIDTH, MAX_HEIGHT, JPEG_QUALITY } from "@collapse/shared";

export interface CaptureSource {
  type: "monitor" | "window";
  id: number;
}

interface ConfirmResult {
  confirmed: boolean;
  trackedSeconds: number;
  nextExpectedAt: string;
}

/**
 * Desktop-native capture hook. Uses Tauri IPC to:
 * 1. Take a native screenshot via xcap (Rust)
 * 2. Upload directly from Rust (no CORS)
 * 3. Confirm with the server
 */
export function useNativeCapture(
  token: string,
  apiBaseUrl: string,
  source: CaptureSource,
) {
  const [isCapturing, setIsCapturing] = useState(false);
  const [trackedSeconds, setTrackedSeconds] = useState(0);
  const [screenshotCount, setScreenshotCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const configuredRef = useRef(false);
  const sourceRef = useRef(source);
  sourceRef.current = source;

  // Single capture: screenshot → upload → confirm
  const captureOnce = useCallback(async () => {
    try {
      const result = await invoke<ConfirmResult>("capture_and_upload", {
        source: sourceRef.current,
        maxWidth: MAX_WIDTH,
        maxHeight: MAX_HEIGHT,
        jpegQuality: Math.round(JPEG_QUALITY * 100),
      });
      setTrackedSeconds(result.trackedSeconds);
      setScreenshotCount((c) => c + 1);
      setError(null);
    } catch (err) {
      const msg = err instanceof Error
        ? err.message + (err.stack ? "\n" + err.stack : "")
        : String(err);
      setError(msg);
    }
  }, []);

  // Keep captureOnce in a ref so the interval always calls the latest version
  const captureRef = useRef(captureOnce);
  captureRef.current = captureOnce;

  // The capture loop: one effect manages the entire interval lifecycle.
  // Starts when isCapturing becomes true, stops when it becomes false.
  useEffect(() => {
    if (!isCapturing) return;

    captureRef.current();
    const id = setInterval(() => captureRef.current(), SCREENSHOT_INTERVAL_MS);
    return () => clearInterval(id);
  }, [isCapturing]);

  const startCapturing = useCallback(async () => {
    if (!configuredRef.current) {
      await invoke("configure", { token, apiBaseUrl });
      configuredRef.current = true;
    }
    setIsCapturing(true);
    setError(null);
  }, [token, apiBaseUrl]);

  const stopCapturing = useCallback(() => {
    setIsCapturing(false);
  }, []);

  return {
    isCapturing,
    trackedSeconds,
    screenshotCount,
    error,
    startCapturing,
    stopCapturing,
  };
}
