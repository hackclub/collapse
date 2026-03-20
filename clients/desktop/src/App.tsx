import React, { useState, useEffect, useCallback } from "react";
import { onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { invoke } from "./logger.js";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Gallery,
  SessionDetail,
  useTokenStore,
  useGallery,
  useHashRouter,
} from "@collapse/react";
import { isValidToken, extractToken } from "./utils.js";
import { PermissionScreen } from "./components/PermissionScreen.js";
import { RecordPage } from "./components/RecordPage.js";

const API_BASE = "https://collapse.b.selfhosted.hackclub.com";

/** Pause a session by token. Fire-and-forget, logs errors. */
async function pauseSession(token: string): Promise<void> {
  try {
    console.log(`[app] pausing session ${token.slice(0, 8)}...`);
    await fetch(`${API_BASE}/api/sessions/${token}/pause`, { method: "POST" });
    console.log(`[app] paused session ${token.slice(0, 8)}`);
  } catch (e) {
    console.error(`[app] failed to pause session ${token.slice(0, 8)}:`, e);
  }
}

/** Fetch a session's status. Returns null on error. */
async function fetchSessionStatus(token: string): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/api/sessions/${token}/status`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.status ?? null;
  } catch {
    return null;
  }
}

export function App() {
  const isMacOS = navigator.userAgent.includes("Mac");
  const [permissionGranted, setPermissionGranted] = useState(!isMacOS);
  const { route, navigate } = useHashRouter();
  const tokenStore = useTokenStore();
  const gallery = useGallery({
    apiBaseUrl: API_BASE,
    tokens: tokenStore.getAllTokenValues(),
  });

  // Deep link handler -- saves token and navigates appropriately.
  // If currently recording another session, pauses it first.
  // Tracks the last processed URL to deduplicate retried cold-start emits.
  const lastDeepLink = React.useRef<string | null>(null);
  const handleDeepLinkUrls = useCallback(
    async (urls: string[]) => {
      console.log("[app] deep link received:", urls);
      for (const url of urls) {
        if (url === lastDeepLink.current) return; // already handled
        const token = extractToken(url);
        if (!token) continue;

        console.log(`[app] extracted token: ${token.slice(0, 8)}...`);
        lastDeepLink.current = url;
        tokenStore.addToken(token);

        // If we're currently recording a different session, pause it first
        if (route.page === "record" && route.token && route.token !== token) {
          console.log(`[app] deep link interrupting active session ${route.token.slice(0, 8)}...`);
          await pauseSession(route.token);
        }

        // Check the incoming session's status to decide where to go
        const status = await fetchSessionStatus(token);
        console.log(`[app] incoming session status: ${status}`);

        if (status && ["stopped", "compiling", "complete", "failed"].includes(status)) {
          // Session is finished — go to detail view
          navigate({ page: "session", token });
        } else {
          // Session is recordable (pending/active/paused) or unknown — go to record
          navigate({ page: "record", token });
        }

        // Bring window to front
        getCurrentWindow().setFocus().catch(() => {});
        return;
      }
    },
    [tokenStore, navigate, route],
  );
  // Ref so effects can call the latest version without depending on it
  const handleDeepLinkRef = React.useRef(handleDeepLinkUrls);
  handleDeepLinkRef.current = handleDeepLinkUrls;

  // Listen for deep links while app is running (warm start).
  // Use the ref so this effect never re-subscribes — onOpenUrl creates a
  // Tauri event listener and the async cleanup can race with re-subscription.
  useEffect(() => {
    const unlistenPlugin = onOpenUrl((urls) => {
      handleDeepLinkRef.current(urls);
    });
    return () => { unlistenPlugin.then((fn) => fn()); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll for cold-start deep link URLs exactly once. The Rust side stashes
  // URLs from both get_current() (immediate) and on_open_url (delayed Apple
  // Event). We poll a few times to catch URLs that arrive after launch.
  const coldStartRan = React.useRef(false);
  useEffect(() => {
    if (coldStartRan.current) return;
    coldStartRan.current = true;

    let cancelled = false;
    const check = async () => {
      for (let i = 0; i < 10 && !cancelled; i++) {
        try {
          console.debug(`[app] cold-start poll attempt ${i + 1}/10`);
          const urls = await invoke<string[]>("get_cold_start_urls");
          if (urls.length > 0) {
            handleDeepLinkRef.current(urls);
            return;
          }
        } catch (e) {
          console.debug("[app] cold-start poll miss:", e);
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      console.debug("[app] cold-start poll finished, no urls found");
    };
    check();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle ?token= query param (dev mode) — route through the same handler
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    if (token && isValidToken(token)) {
      handleDeepLinkRef.current([`collapse://session/?token=${token}`]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Enable vibrancy globally for the app
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const root = document.getElementById("root");
    const prevHtmlBg = html.style.background;
    const prevBodyBg = body.style.background;
    const prevRootBg = root?.style.background ?? "";

    let effectsApplied = false;
    
    invoke("enable_vibrancy")
      .then(() => {
        effectsApplied = true;
        html.style.background = "transparent";
        body.style.background = "transparent";
        if (root) root.style.background = "transparent";
      })
      .catch((err) => {
        console.warn("Failed to enable vibrancy", err);
      });

    return () => {
      if (effectsApplied) {
        invoke("disable_vibrancy").catch(() => {});
      }
      html.style.background = prevHtmlBg;
      body.style.background = prevBodyBg;
      if (root) root.style.background = prevRootBg;
    };
  }, []);

  // Step 2: Route
  const content = (() => {
    switch (route.page) {
      case "gallery":
        return (
          <Gallery
            sessions={gallery.sessions}
            loading={gallery.loading}
            error={gallery.error}
            onSessionClick={(token) => {
              const session = gallery.sessions.find((s) => s.token === token);
              if (session && ["pending", "active", "paused"].includes(session.status)) {
                navigate({ page: "record", token });
              } else {
                navigate({ page: "session", token });
              }
            }}
            onArchive={(token) => {
              tokenStore.archiveToken(token);
              gallery.refresh();
            }}
            onRefresh={gallery.refresh}
          />
        );
      case "record":
        return (
          <RecordPage
            token={route.token}
            onBack={() => {
              gallery.refresh();
              navigate({ page: "gallery" });
            }}
            onViewSession={(token) => {
              tokenStore.addToken(token);
              navigate({ page: "session", token });
            }}
          />
        );
      case "session":
        return (
          <SessionDetail
            token={route.token}
            apiBaseUrl={API_BASE}
            onBack={() => navigate({ page: "gallery" })}
            onArchive={() => {
              tokenStore.archiveToken(route.token);
              navigate({ page: "gallery" });
            }}
          />
        );
      default:
        return null;
    }
  })();

  const mainView = !permissionGranted ? (
    <PermissionScreen onGranted={() => setPermissionGranted(true)} />
  ) : (
    content
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      {/* Draggable Titlebar Area that dodges the traffic lights (macOS only) */}
      {isMacOS && (
        <div
          data-tauri-drag-region
          className="titlebar"
          style={{ height: 32, flexShrink: 0, width: "100%", zIndex: 9999, background: "transparent", cursor: "default" }}
        />
      )}
      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
        {mainView}
      </div>
    </div>
  );
}
