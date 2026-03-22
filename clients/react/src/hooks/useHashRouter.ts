import { useState, useCallback, useEffect } from "react";

export type Route =
  | { page: "gallery" }
  | { page: "add" }
  | { page: "record"; token: string }
  | { page: "session"; token: string }
  | { page: "tray" };

function parseHash(hash: string): Route {
  const cleaned = hash.replace(/^#\/?/, "");
  if (!cleaned || cleaned === "/") return { page: "gallery" };

  const [path, queryStr] = cleaned.split("?");
  const params = new URLSearchParams(queryStr ?? "");
  const token = params.get("token") ?? "";

  if (path === "add") return { page: "add" };
  if (path === "tray") return { page: "tray" };
  if (path === "record" && token) return { page: "record", token };
  if (path === "session" && token) return { page: "session", token };

  return { page: "gallery" };
}

function routeToHash(route: Route): string {
  switch (route.page) {
    case "gallery":
      return "#/";
    case "add":
      return "#/add";
    case "tray":
      return "#/tray";
    case "record":
      return `#/record?token=${route.token}`;
    case "session":
      return `#/session?token=${route.token}`;
  }
}

export function useHashRouter() {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));

  useEffect(() => {
    const handler = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);

  // Handle keyboard navigation (Escape or Backspace to go back)
  useEffect(() => {
    const keyHandler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      if (e.key === "Escape" || e.key === "Backspace") {
        const currentRoute = parseHash(window.location.hash);
        if (currentRoute.page !== "gallery") {
          e.preventDefault();
          // We use history.back() to match native backspace behavior 
          // and preserve the history stack. If there is no history, 
          // it safely does nothing, in which case we could fallback, 
          // but window.history.back() works perfectly for hash routes.
          window.history.back();
          
          // Fallback if history.back() didn't change the hash after a short delay
          // (e.g. if this was the first page load and they somehow navigated to a subpage)
          setTimeout(() => {
            if (parseHash(window.location.hash).page !== "gallery") {
              window.location.hash = "#/";
            }
          }, 50);
        }
      }
    };

    window.addEventListener("keydown", keyHandler);
    return () => window.removeEventListener("keydown", keyHandler);
  }, []);

  const navigate = useCallback((r: Route) => {
    window.location.hash = routeToHash(r);
  }, []);

  return { route, navigate };
}
