import { useState, useEffect, useCallback } from "react";
import type { SessionSummary } from "@collapse/shared";

export interface UseGalleryOptions {
  apiBaseUrl: string;
  tokens: string[];
}

export interface UseGallery {
  sessions: SessionSummary[];
  loading: boolean;
  error: string | null;
  refresh(): void;
}

export function useGallery({ apiBaseUrl, tokens }: UseGalleryOptions): UseGallery {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshCounter, setRefreshCounter] = useState(0);

  // Stable reference for the token list to avoid infinite re-renders
  const tokensKey = tokens.join(",");

  const refresh = useCallback(() => setRefreshCounter((c) => c + 1), []);

  useEffect(() => {
    if (tokens.length === 0) {
      setSessions([]);
      setLoading(false);
      setError(null);
      return;
    }

    // Only send valid hex tokens to avoid server-side validation errors
    const validTokens = tokens.filter((t) => /^[a-f0-9]{64}$/i.test(t));
    if (validTokens.length === 0) {
      setSessions([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    fetch(`${apiBaseUrl}/api/sessions/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tokens: validTokens }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`HTTP ${res.status} ${res.statusText}\n${text.slice(0, 500)}`);
        }
        return res.json();
      })
      .then((data: { sessions: SessionSummary[] }) => {
        if (!cancelled) {
          setSessions(data.sessions ?? []);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.warn("Gallery fetch error:", err);
          setError(err.message);
          // Keep showing whatever sessions we had
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, tokensKey, refreshCounter]);

  // Re-fetch on tab focus
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [refresh]);

  return { sessions, loading, error, refresh };
}
