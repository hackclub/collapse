import React, { useState, useEffect, useCallback } from "react";
import { onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { invoke } from "./logger.js";
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

export function App() {
  const isMacOS = navigator.platform.startsWith("Mac");
  const [permissionGranted, setPermissionGranted] = useState(!isMacOS);
  const { route, navigate } = useHashRouter();
  const tokenStore = useTokenStore();
  const gallery = useGallery({
    apiBaseUrl: API_BASE,
    tokens: tokenStore.getAllTokenValues(),
  });

  // Deep link handler -- saves token and navigates to record.
  // Tracks the last processed URL to deduplicate retried cold-start emits.
  const lastDeepLink = React.useRef<string | null>(null);
  const handleDeepLinkUrls = useCallback(
    (urls: string[]) => {
      console.log("[app] deep link received:", urls);
      for (const url of urls) {
        if (url === lastDeepLink.current) return; // already handled
        const token = extractToken(url);
        if (token) {
          console.log(`[app] extracted token: ${token.slice(0, 8)}...`);
          lastDeepLink.current = url;
          tokenStore.addToken(token);
          navigate({ page: "record", token });
          return;
        }
      }
    },
    [tokenStore, navigate],
  );
  // Ref so effects can call the latest version without depending on it
  const handleDeepLinkRef = React.useRef(handleDeepLinkUrls);
  handleDeepLinkRef.current = handleDeepLinkUrls;

  // Listen for deep links while app is running (warm start)
  useEffect(() => {
    const unlistenPlugin = onOpenUrl((urls) => {
      handleDeepLinkUrls(urls);
    });
    return () => { unlistenPlugin.then((fn) => fn()); };
  }, [handleDeepLinkUrls]);

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

  // Handle ?token= query param (dev mode)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    if (token && isValidToken(token)) {
      tokenStore.addToken(token);
      navigate({ page: "record", token });
    }
  }, []);

  // Step 1: Permission check (macOS)
  if (!permissionGranted) {
    return <PermissionScreen onGranted={() => setPermissionGranted(true)} />;
  }

  // Step 2: Route
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
  }
}
