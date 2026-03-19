import { useCallback, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SCREENSHOT_INTERVAL_MS, MAX_WIDTH, MAX_HEIGHT, JPEG_QUALITY } from "@collapse/shared";

export interface CaptureSource {
  type: "monitor" | "window";
  id: number;
}

interface NativeCaptureResult {
  base64: string;
  width: number;
  height: number;
  size_bytes: number;
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
 *
 * Replaces useScreenCapture + useUploader from @collapse/react.
 */
export function useNativeCapture(
  token: string,
  apiBaseUrl: string,
  source: CaptureSource,
) {
  const [isCapturing, setIsCapturing] = useState(false);
  const [trackedSeconds, setTrackedSeconds] = useState(0);
  const [lastScreenshotUrl, setLastScreenshotUrl] = useState<string | null>(null);
  const [screenshotCount, setScreenshotCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const configuredRef = useRef(false);
  const sourceRef = useRef(source);
  sourceRef.current = source;

  const configure = useCallback(async () => {
    if (configuredRef.current) return;
    await invoke("configure", { token, apiBaseUrl });
    configuredRef.current = true;
  }, [token, apiBaseUrl]);

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

      // Also get the screenshot for preview (smaller for perf)
      try {
        const preview = await invoke<NativeCaptureResult>("take_screenshot", {
          source: sourceRef.current,
          maxWidth: 480,
          maxHeight: 270,
          jpegQuality: 60,
        });
        setLastScreenshotUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          const bytes = Uint8Array.from(atob(preview.base64), (c) => c.charCodeAt(0));
          const blob = new Blob([bytes], { type: "image/jpeg" });
          return URL.createObjectURL(blob);
        });
      } catch {
        // Preview is non-critical
      }
    } catch (err) {
      const msg = err instanceof Error
        ? err.message + (err.stack ? "\n" + err.stack : "")
        : String(err);
      setError(msg);
    }
  }, []);

  const startCapturing = useCallback(async () => {
    await configure();
    setIsCapturing(true);
    setError(null);
    // Capture immediately, then on interval
    captureOnce();
    intervalRef.current = setInterval(captureOnce, SCREENSHOT_INTERVAL_MS);
  }, [configure, captureOnce]);

  const stopCapturing = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsCapturing(false);
  }, []);

  return {
    isCapturing,
    trackedSeconds,
    lastScreenshotUrl,
    screenshotCount,
    error,
    startCapturing,
    stopCapturing,
  };
}
