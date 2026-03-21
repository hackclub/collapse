import { useState, useCallback, useEffect } from "react";

export type Route =
  | { page: "gallery" }
  | { page: "add" }
  | { page: "record"; token: string }
  | { page: "session"; token: string };

function parseHash(hash: string): Route {
  const cleaned = hash.replace(/^#\/?/, "");
  if (!cleaned || cleaned === "/") return { page: "gallery" };

  const [path, queryStr] = cleaned.split("?");
  const params = new URLSearchParams(queryStr ?? "");
  const token = params.get("token") ?? "";

  if (path === "add") return { page: "add" };
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

  const navigate = useCallback((r: Route) => {
    window.location.hash = routeToHash(r);
  }, []);

  return { route, navigate };
}
