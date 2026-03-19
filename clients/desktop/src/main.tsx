import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { createRoot } from "react-dom/client";
import React from "react";
import { App } from "./App.js";

// Wrap fetch so only cross-origin requests go through Tauri's HTTP plugin.
// Keeping native fetch for same-origin/local requests avoids breaking React internals.
const originalFetch = window.fetch;
window.fetch = function (input, init) {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return tauriFetch(input as any, init) as any;
  }
  return originalFetch.call(window, input, init);
};

// Clear any bad stored tokens from previous testing
try {
  const raw = localStorage.getItem("collapse-tokens");
  if (raw) JSON.parse(raw);
} catch {
  localStorage.removeItem("collapse-tokens");
}

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: string | null }
> {
  state = { error: null as string | null };
  static getDerivedStateFromError(err: Error) {
    return { error: err.stack || err.message };
  }
  render() {
    if (this.state.error) {
      return (
        <pre style={{ color: "red", padding: 20, fontSize: 12, whiteSpace: "pre-wrap" }}>
          {this.state.error}
        </pre>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
