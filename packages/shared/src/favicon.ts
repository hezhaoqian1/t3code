import { isPublicFaviconHost } from "./hostClassification.ts";

/**
 * Return a public favicon URL that discloses only a public hostname, never the
 * port, path, or a private or internal-looking host. Callers show a generic
 * icon when this returns null.
 */
export function faviconUrlForOrigin(rawUrl: string | null | undefined, size = 32): string | null {
  if (!rawUrl) return null;
  try {
    const url = new URL(rawUrl);
    if (!url.hostname) return null;
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!isPublicFaviconHost(url.hostname)) return null;
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(url.hostname)}&sz=${size}`;
  } catch {
    return null;
  }
}
