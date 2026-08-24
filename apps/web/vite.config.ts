import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { defineProject, type TestProjectInlineConfiguration } from "vite-plus/test/config";
import "vite-plus/test/config";
import { defineConfig } from "vite-plus";
import pkg from "./package.json" with { type: "json" };

import { DEV_PROXIED_PATH_PREFIXES } from "@t3tools/shared/devProxy";

import { loadRepoEnv } from "../../scripts/lib/public-config";
import { prepareViteDevelopmentBootstrap } from "./src/devBootstrap";

const repoEnv = loadRepoEnv();
Object.assign(process.env, repoEnv);

const port = Number(process.env.PORT ?? 5733);
export const DEV_SERVER_LOOPBACK_HOST = "127.0.0.1";
export const DEV_SERVER_ALLOWED_HOSTS = [DEV_SERVER_LOOPBACK_HOST] as const;
const configuredAppVersion = process.env.APP_VERSION?.trim() || pkg.version;
const sourcemapEnv = process.env.T3CODE_WEB_SOURCEMAP?.trim().toLowerCase();

// Vite 8.1's experimental bundled dev mode: serves rolldown-bundled chunks in
// dev for much faster startup/reload on large module graphs, with HMR served
// as hot patches. Opt-in while experimental: T3CODE_BUNDLED_DEV=1 pnpm dev:web
// T3CODE_BUNDLED_DEV=0 opts out when local development needs unbundled modules.
const bundledDevEnv = process.env.T3CODE_BUNDLED_DEV?.trim().toLowerCase();
const bundledDev = bundledDevEnv === "1" || bundledDevEnv === "true";

const buildSourcemap: boolean | "hidden" =
  sourcemapEnv === "1" || sourcemapEnv === "true"
    ? true
    : sourcemapEnv === "hidden"
      ? "hidden"
      : false;

const unitTestProject = {
  extends: true,
  test: {
    name: "unit",
    include: ["src/**/*.test.{ts,tsx}"],
    // The web runtime suite exercises auth bootstrap and websocket subscription
    // lifecycles. Under the full monorepo test
    // run, those async tests can exceed Vitest's default 5s budget.
    hookTimeout: 15_000,
    testTimeout: 15_000,
  },
} satisfies TestProjectInlineConfiguration;

export function resolveLoopbackDevProxyTarget(rawTarget: string): string | undefined {
  try {
    const target = new URL(rawTarget);
    if (
      target.protocol !== "http:" ||
      target.hostname !== "127.0.0.1" ||
      target.username !== "" ||
      target.password !== ""
    ) {
      return undefined;
    }
    target.pathname = "/";
    target.search = "";
    target.hash = "";
    return target.toString();
  } catch {
    return undefined;
  }
}

export function resolveDevProxyTarget(backendPort: string | undefined): string | undefined {
  const port = Number(backendPort?.trim());
  if (Number.isSafeInteger(port) && port > 0 && port <= 65_535) {
    return resolveLoopbackDevProxyTarget(`http://127.0.0.1:${port}/`);
  }
  return undefined;
}

const devProxyTarget = resolveDevProxyTarget(process.env.T3CODE_PORT);

export default defineConfig(({ command }) => {
  const developmentBootstrapDefine = prepareViteDevelopmentBootstrap({
    command,
    enabled: process.env.T3CODE_DEV_BROWSER_BOOTSTRAP === "1",
    environment: process.env,
  });
  return {
    assetsInclude: ["**/*.wasm"],
    plugins: [
      tanstackRouter({ autoCodeSplitting: true }),
      react(),
      babel({
        // We need to be explicit about the parser options after moving to @vitejs/plugin-react v6.0.0
        // This is because the babel plugin only automatically parses typescript and jsx based on relative paths (e.g. "**/*.ts")
        // whereas the previous version of the plugin parsed all files with a .ts extension.
        // This is causing our packages/ directory to fail to parse, as they are not relative to the CWD.
        parserOpts: { plugins: ["typescript", "jsx"] },
        presets: [reactCompilerPreset()],
      }),
      tailwindcss(),
    ],
    optimizeDeps: {
      include: [
        "@pierre/diffs",
        "@pierre/diffs/editor",
        "@pierre/diffs/react",
        "@pierre/diffs/worker/worker.js",
        "effect/Array",
        "effect/Order",
        "react-dom/client",
      ],
    },
    define: {
      ...developmentBootstrapDefine,
      "import.meta.env.APP_VERSION": JSON.stringify(configuredAppVersion),
    },
    resolve: {
      tsconfigPaths: true,
      dedupe: ["react", "react-dom"],
    },
    experimental: {
      bundledDev,
    },
    server: {
      host: DEV_SERVER_LOOPBACK_HOST,
      port,
      strictPort: true,
      allowedHosts: [...DEV_SERVER_ALLOWED_HOSTS],
      // Transform the whole module graph at server start instead of on the
      // first request. Without this, a cold worktree discovers and transforms
      // modules one import-level at a time while the browser waits — which
      // over a tailnet origin turns into minutes of waterfall.
      warmup: {
        clientFiles: ["./src/main.tsx"],
      },
      ...(devProxyTarget
        ? {
            // One entry per shared prefix; the server's dev catch-all 404s the
            // same list, so the two sides cannot drift. `/ws` is the app's own
            // socket — Vite's HMR socket is matched separately and exactly
            // (path "/" plus a vite-hmr subprotocol), so the two upgrade
            // handlers don't collide.
            proxy: Object.fromEntries(
              DEV_PROXIED_PATH_PREFIXES.map((prefix) => [
                prefix,
                {
                  target: devProxyTarget,
                  changeOrigin: true,
                  ...(prefix === "/ws" ? { ws: true } : {}),
                },
              ]),
            ),
          }
        : {}),
      hmr: {
        protocol: "ws",
        host: DEV_SERVER_LOOPBACK_HOST,
        clientPort: port,
      },
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
      sourcemap: buildSourcemap,
    },
    test: {
      projects: [defineProject(unitTestProject)],
    },
  };
});
