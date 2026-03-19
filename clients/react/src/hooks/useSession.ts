import { useState, useEffect, useCallback, useRef } from "react";
import { useCollapseContext } from "../CollapseProvider.js";
import type { RecorderStatus } from "../types.js";

interface SessionState {
  status: RecorderStatus;
  name: string;
  trackedSeconds: number;
  screenshotCount: number;
  startedAt: string | null;
  createdAt: string | null;
  totalActiveSeconds: number;
  error: string | null;
}

export function useSession() {
  const { client, config } = useCollapseContext();
  const pollIntervalMs = config.statusPollIntervalMs;

  const [state, setState] = useState<SessionState>({
    status: "loading",
    name: "",
    trackedSeconds: 0,
    screenshotCount: 0,
    startedAt: null,
    createdAt: null,
    totalActiveSeconds: 0,
    error: null,
  });

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadSession = useCallback(async () => {
    let token: string;
    try {
      token = await client.resolveToken();
    } catch {
      setState((s) => ({ ...s, status: "no-token" }));
      return;
    }
    if (!token) {
      setState((s) => ({ ...s, status: "no-token" }));
      return;
    }

    try {
      const data = await client.getSession();
      setState({
        status: data.status,
        name: data.name,
        trackedSeconds: data.trackedSeconds,
        screenshotCount: data.screenshotCount,
        startedAt: data.startedAt,
        createdAt: data.createdAt,
        totalActiveSeconds: data.totalActiveSeconds,
        error: null,
      });

      if (data.status === "compiling" || data.status === "stopped") {
        startPolling();
      }
    } catch (err) {
      setState((s) => ({
        ...s,
        status: "error",
        error: err instanceof Error ? err.message : "Unknown error",
      }));
    }
  }, [client]);

  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      try {
        const data = await client.getStatus();
        setState((s) => ({
          ...s,
          status: data.status,
          trackedSeconds: data.trackedSeconds,
        }));
        if (data.status === "complete" || data.status === "failed") {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
        }
      } catch {
        // Ignore poll errors
      }
    }, pollIntervalMs);
  }, [client, pollIntervalMs]);

  const pause = useCallback(async () => {
    const data = await client.pause();
    setState((s) => ({
      ...s,
      status: data.status,
      totalActiveSeconds: data.totalActiveSeconds,
    }));
  }, [client]);

  const resume = useCallback(async () => {
    const data = await client.resume();
    setState((s) => ({ ...s, status: data.status }));
  }, [client]);

  const stop = useCallback(async (name?: string) => {
    // Optionally name the timelapse before stopping (non-fatal if it fails)
    if (name) {
      try {
        await client.rename(name);
      } catch {
        // Non-fatal — server defaults to "untitled-YYYY-MM-DD"
      }
    }
    const data = await client.stop();
    setState((s) => ({
      ...s,
      status: data.status,
      trackedSeconds: data.trackedSeconds,
      totalActiveSeconds: data.totalActiveSeconds,
    }));
    startPolling();
  }, [client, startPolling]);

  const updateTrackedSeconds = useCallback((seconds: number) => {
    setState((s) => ({ ...s, trackedSeconds: seconds }));
  }, []);

  const setError = useCallback((error: string | null) => {
    setState((s) => ({ ...s, error, ...(error ? { status: "error" as const } : {}) }));
  }, []);

  useEffect(() => {
    loadSession();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [loadSession]);

  return {
    ...state,
    pause,
    resume,
    stop,
    reload: loadSession,
    updateTrackedSeconds,
    setError,
  };
}
