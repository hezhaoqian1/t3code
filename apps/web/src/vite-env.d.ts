/// <reference types="vite-plus/client" />

import type { DesktopBridge } from "@t3tools/contracts";

interface ImportMetaEnv {
  readonly VITE_DEV_SERVER_URL?: string;
  readonly VITE_T3CODE_DEV_BOOTSTRAP_TOKEN: string;
  readonly APP_VERSION: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare global {
  interface Window {
    desktopBridge?: DesktopBridge;
  }
}
