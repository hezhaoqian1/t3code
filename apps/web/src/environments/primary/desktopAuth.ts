export function readDesktopPrimaryBearerToken(): Promise<string | null> {
  if (typeof window === "undefined") {
    return Promise.resolve(null);
  }
  const bridge = window.desktopBridge;
  if (!bridge) {
    return Promise.resolve(null);
  }

  return bridge.getLocalEnvironmentBearerToken();
}

export function refreshDesktopPrimaryBearerToken(): Promise<string | null> {
  if (typeof window === "undefined" || window.desktopBridge === undefined)
    return Promise.resolve(null);
  return window.desktopBridge.refreshLocalEnvironmentBearerToken();
}
