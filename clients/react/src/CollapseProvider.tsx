import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { createCollapseClient, type CollapseClient } from "./api/client.js";
import { resolveConfig } from "./defaults.js";
import type { CollapseConfig, ResolvedConfig } from "./types.js";

interface CollapseContextValue {
  config: ResolvedConfig;
  client: CollapseClient;
}

const CollapseContext = createContext<CollapseContextValue | null>(null);

export function useCollapseContext(): CollapseContextValue {
  const ctx = useContext(CollapseContext);
  if (!ctx) {
    throw new Error(
      "Collapse hooks must be used within a <CollapseProvider>. " +
        "Wrap your component tree with <CollapseProvider token=\"...\">.",
    );
  }
  return ctx;
}

export interface CollapseProviderProps extends CollapseConfig {
  children: ReactNode;
}

export function CollapseProvider({
  children,
  ...config
}: CollapseProviderProps) {
  const resolved = useMemo(() => resolveConfig(config), [config]);

  const client = useMemo(
    () =>
      createCollapseClient({
        baseUrl: resolved.apiBaseUrl,
        token: resolved.token,
      }),
    [resolved.apiBaseUrl, resolved.token],
  );

  const value = useMemo(() => ({ config: resolved, client }), [resolved, client]);

  // Inject CSS @keyframes used by SDK components (pulse, spin).
  // Deduped: only injects once even if multiple providers mount.
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (document.querySelector("style[data-collapse-keyframes]")) return;
    const style = document.createElement("style");
    style.setAttribute("data-collapse-keyframes", "");
    style.textContent = [
      "@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}",
      "@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}",
      "@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}",
    ].join("");
    document.head.appendChild(style);
  }, []);

  return (
    <CollapseContext.Provider value={value}>
      {children}
    </CollapseContext.Provider>
  );
}
