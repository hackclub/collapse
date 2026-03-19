import React, { useState, useEffect, useCallback } from "react";
import { onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { invoke } from "@tauri-apps/api/core";
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
  const [permissionGranted, setPermissionGranted] = useState(false);
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
      for (const url of urls) {
        if (url === lastDeepLink.current) return; // already handled
        const token = extractToken(url);
        if (token) {
          lastDeepLink.current = url;
          tokenStore.addToken(token);
          navigate({ page: "record", token });
          return;
        }
      }
    },
    [tokenStore, navigate],
  );

  // Listen for deep links while app is running (warm start)
  useEffect(() => {
    const unlistenPlugin = onOpenUrl((urls) => {
      handleDeepLinkUrls(urls);
    });
    return () => { unlistenPlugin.then((fn) => fn()); };
  }, [handleDeepLinkUrls]);

  // Poll for cold-start deep link URLs. The Rust side stashes URLs from both
  // get_current() (immediate) and on_open_url (delayed Apple Event). We poll
  // a few times to catch URLs that arrive after the app finishes launching.
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      for (let i = 0; i < 10 && !cancelled; i++) {
        try {
          const urls = await invoke<string[]>("get_cold_start_urls");
          if (urls.length > 0) {
            handleDeepLinkUrls(urls);
            return;
          }
        } catch {}
        await new Promise((r) => setTimeout(r, 500));
      }
    };
    check();
    return () => { cancelled = true; };
  }, [handleDeepLinkUrls]);

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
