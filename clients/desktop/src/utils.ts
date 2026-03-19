export function isValidToken(token: string): boolean {
  return /^[a-f0-9]{64}$/i.test(token);
}

export function extractToken(url: string): string | null {
  try {
    const normalized = url.replace("collapse://", "https://collapse.local/");
    const parsed = new URL(normalized);
    const fromQuery = parsed.searchParams.get("token");
    if (fromQuery && isValidToken(fromQuery)) return fromQuery;
    const segments = parsed.pathname.split("/").filter(Boolean);
    const candidate =
      segments.length >= 2
        ? segments[1]
        : segments.length === 1 && segments[0] !== "session"
          ? segments[0]
          : null;
    if (candidate && isValidToken(candidate)) return candidate;
    return null;
  } catch {
    return null;
  }
}
