import { useCallback, useEffect, useRef } from "react";
import { useCollapseContext } from "../CollapseProvider.js";
import { useScreenCapture } from "./useScreenCapture.js";
import { useUploader } from "./useUploader.js";
import { useSession } from "./useSession.js";
import { useSessionTimer } from "./useSessionTimer.js";
import type { CollapseState, CollapseActions, RecorderStatus } from "../types.js";

/**
 * Primary hook for Collapse integration.
 * Composes all lower-level hooks and orchestrates the capture-upload loop.
 */
export function useCollapse(): { state: CollapseState; actions: CollapseActions } {
  const { config } = useCollapseContext();
  const callbacksRef = useRef(config.callbacks);
  callbacksRef.current = config.callbacks;

  const session = useSession();
  const capture = useScreenCapture();
  const uploader = useUploader();
  const displaySeconds = useSessionTimer(
    session.trackedSeconds,
    session.status === "active" && capture.isSharing,
  );

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const capturingRef = useRef(false);
  const prevStatusRef = useRef<RecorderStatus>(session.status);

  // Sync tracked seconds from uploader to session
  useEffect(() => {
    if (uploader.trackedSeconds > 0) {
      session.updateTrackedSeconds(uploader.trackedSeconds);
    }
  }, [uploader.trackedSeconds, session.updateTrackedSeconds]);

  // Fire onStatusChange callback
  useEffect(() => {
    const prev = prevStatusRef.current;
    const next = session.status;
    if (prev !== next) {
      callbacksRef.current.onStatusChange?.(prev, next);
      if (next === "failed") {
        callbacksRef.current.onCompilationFailed?.();
      }
      prevStatusRef.current = next;
    }
  }, [session.status]);

  // Capture callback stored in a ref so the interval always calls the latest
  // version without needing to clear/recreate the interval on every render.
  const captureAndUploadRef = useRef(async () => {
    const result = await capture.takeScreenshot();
    if (result) {
      callbacksRef.current.onCapture?.(result);
      uploader.enqueue(result);
    }
  });
  captureAndUploadRef.current = async () => {
    const result = await capture.takeScreenshot();
    if (result) {
      callbacksRef.current.onCapture?.(result);
      uploader.enqueue(result);
    }
  };

  // Start/stop capture interval based on sharing + session state.
  // Uses a ref for the callback so the interval survives re-renders
  // without being cleared (fixes React StrictMode + parent re-render issues).
  const isActive = session.status === "active" || session.status === "pending";

  useEffect(() => {
    if (!capture.isSharing || !isActive) return;

    capturingRef.current = true;
    captureAndUploadRef.current();
    const id = setInterval(() => captureAndUploadRef.current(), config.capture.intervalMs);
    intervalRef.current = id;

    return () => {
      capturingRef.current = false;
      clearInterval(id);
      intervalRef.current = null;
    };
  }, [capture.isSharing, isActive, config.capture.intervalMs]);

  // Auto-resume when screen sharing starts while session is paused
  // (e.g., user clicked "Share Screen & Resume" after a reload)
  useEffect(() => {
    if (capture.isSharing && session.status === "paused") {
      session.resume().then(() => {
        callbacksRef.current.onResume?.();
      }).catch(() => {});
    }
  }, [capture.isSharing, session.status, session.resume]);

  // Auto-pause when screen sharing ends unexpectedly
  useEffect(() => {
    if (!capture.isSharing && session.status === "active" && capturingRef.current) {
      capturingRef.current = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      callbacksRef.current.onShareStop?.();
      session.pause().catch(() => {});
    }
  }, [capture.isSharing, session.status, session.pause]);

  // Auto-start
  useEffect(() => {
    if (
      config.autoStart &&
      !capture.isSharing &&
      (session.status === "pending" || session.status === "active")
    ) {
      capture.startSharing().catch(() => {});
    }
  }, [config.autoStart, session.status, capture.isSharing, capture.startSharing]);

  // Actions
  const startSharing = useCallback(async () => {
    try {
      await capture.startSharing();
      callbacksRef.current.onShareStart?.();
      // Auto-resume is handled by the useEffect above reacting to
      // capture.isSharing becoming true while session.status is "paused"
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      let message: string;
      if (e.name === "NotAllowedError") {
        message = "Screen sharing permission was denied. Please try again and select a screen to share.";
      } else if (e.name === "AbortError") {
        message = "Screen sharing was cancelled.";
      } else {
        message = e.message || "Failed to start screen sharing.";
      }
      callbacksRef.current.onError?.(new Error(message), "startSharing");
      session.setError(message);
    }
  }, [capture.startSharing, session]);

  const stopSharing = useCallback(() => {
    capture.stopSharing();
    callbacksRef.current.onShareStop?.();
  }, [capture.stopSharing]);

  const pause = useCallback(async () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    capturingRef.current = false;
    await session.pause();
    callbacksRef.current.onPause?.({ totalActiveSeconds: session.totalActiveSeconds });
  }, [session.pause, session.totalActiveSeconds]);

  const resume = useCallback(async () => {
    await session.resume();
    callbacksRef.current.onResume?.();
  }, [session.resume]);

  const stop = useCallback(async (options?: { name?: string }) => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    capturingRef.current = false;
    capture.stopSharing();
    await session.stop(options?.name);
    callbacksRef.current.onStop?.({
      trackedSeconds: session.trackedSeconds,
      totalActiveSeconds: session.totalActiveSeconds,
    });
  }, [session.stop, session.trackedSeconds, session.totalActiveSeconds, capture.stopSharing]);

  const state: CollapseState = {
    status: session.status,
    isSharing: capture.isSharing,
    trackedSeconds: session.trackedSeconds,
    displaySeconds,
    screenshotCount: session.screenshotCount,
    uploads: uploader.uploads,
    lastScreenshotUrl: uploader.lastScreenshotUrl,
    videoUrl: null,
    error: session.error,
  };

  const actions: CollapseActions = {
    startSharing,
    stopSharing,
    pause,
    resume,
    stop,
  };

  return { state, actions };
}
