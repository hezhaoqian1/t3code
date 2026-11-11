import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Tracer from "effect/Tracer";
import {
  HttpClient,
  HttpClientRequest,
  HttpRouter,
  HttpServerResponse,
} from "effect/unstable/http";
import { describe } from "vite-plus/test";

import { ASSET_ROUTE_PREFIX } from "./assets/AssetAccess.ts";
import { ATTACHMENT_UPLOAD_ROUTE_PREFIX } from "./assets/AttachmentUpload.ts";
import {
  assetResponseHeaders,
  isLoopbackHostname,
  resolveDevRedirectUrl,
  withUntracedRequests,
} from "./http.ts";

describe("http dev routing", () => {
  it("treats localhost and loopback addresses as local", () => {
    expect(isLoopbackHostname("127.0.0.1")).toBe(true);
    expect(isLoopbackHostname("localhost")).toBe(true);
    expect(isLoopbackHostname("::1")).toBe(true);
    expect(isLoopbackHostname("[::1]")).toBe(true);
  });

  it("rejects wildcard, LAN, tailnet, and non-loopback IPv6 hosts", () => {
    for (const hostname of [
      "0.0.0.0",
      "192.168.86.35",
      "10.0.0.24",
      "host.example.ts.net",
      "fd7a:115c:a1e0::1",
      "[fd7a:115c:a1e0::1]",
    ]) {
      expect(isLoopbackHostname(hostname)).toBe(false);
    }
  });

  it("preserves path and query when redirecting to the dev server", () => {
    const devUrl = new URL("http://127.0.0.1:5173/");
    const requestUrl = new URL("http://127.0.0.1:3774/pair?token=test-token");

    expect(resolveDevRedirectUrl(devUrl, requestUrl)).toBe(
      "http://127.0.0.1:5173/pair?token=test-token",
    );
  });
});

describe("assetResponseHeaders", () => {
  it("sandboxes SVG assets", () => {
    expect(assetResponseHeaders("/attachments/user-image.svg")).toMatchObject({
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "X-Content-Type-Options": "nosniff",
    });
    expect(assetResponseHeaders("/attachments/user-image.SVG")).toHaveProperty(
      "Content-Security-Policy",
    );
  });

  it("does not apply document policy to raster images", () => {
    expect(assetResponseHeaders("/attachments/user-image.png")).toEqual({
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    });
  });

  it("declares utf-8 for HTML assets so non-ASCII content renders correctly", () => {
    expect(assetResponseHeaders("/workspace/page.html")).toHaveProperty(
      "Content-Type",
      "text/html; charset=utf-8",
    );
    expect(assetResponseHeaders("/workspace/PAGE.HTM")).toHaveProperty(
      "Content-Type",
      "text/html; charset=utf-8",
    );
  });

  it("isolates generated HTML from the authenticated server origin", () => {
    for (const path of ["/workspace/中文报告.html", "/workspace/PAGE.HTM"]) {
      expect(assetResponseHeaders(path)["Content-Security-Policy"]).toBe(
        "sandbox allow-scripts allow-forms allow-popups allow-downloads",
      );
    }
  });
});

describe("untraced requests", () => {
  it.effect("keeps signed asset and upload URLs out of HTTP server spans", () =>
    Effect.gen(function* () {
      const serverSpans: Array<string> = [];
      const layerTracer = Layer.succeed(
        Tracer.Tracer,
        Tracer.make({
          span: (options) => {
            if (options.kind === "server") serverSpans.push(options.name);
            return new Tracer.NativeSpan(options);
          },
        }),
      );
      const layerRoutes = Layer.effectDiscard(
        Effect.gen(function* () {
          const router = yield* HttpRouter.HttpRouter;
          yield* router.add("GET", `${ASSET_ROUTE_PREFIX}/*`, HttpServerResponse.empty());
          yield* router.add(
            "POST",
            `${ATTACHMENT_UPLOAD_ROUTE_PREFIX}/*`,
            HttpServerResponse.empty(),
          );
          yield* router.add("GET", "/api/environment", HttpServerResponse.empty());
        }),
      );
      const services = yield* Layer.build(
        HttpRouter.serve(layerRoutes, { disableListenLog: true, disableLogger: true }).pipe(
          withUntracedRequests,
          Layer.provideMerge(NodeHttpServer.layerTest),
          Layer.provide(layerTracer),
        ),
      );
      const client = Context.get(services, HttpClient.HttpClient);

      // Each URL is a bearer credential: url.full and url.path would carry it.
      for (const request of [
        HttpClientRequest.get(`${ASSET_ROUTE_PREFIX}/payload.signature/image.png`),
        HttpClientRequest.get(`${ASSET_ROUTE_PREFIX}/payload.signature/image.png?v=1`),
        HttpClientRequest.post(`${ATTACHMENT_UPLOAD_ROUTE_PREFIX}/payload.signature`),
        HttpClientRequest.post(`${ATTACHMENT_UPLOAD_ROUTE_PREFIX}/payload.signature?v=1`),
        HttpClientRequest.head(`${ASSET_ROUTE_PREFIX}/payload.signature/image.png`),
      ]) {
        expect((yield* client.execute(request)).status).toBe(204);
      }
      expect(serverSpans).toEqual([]);

      expect((yield* client.execute(HttpClientRequest.get("/api/environment"))).status).toBe(204);
      expect(serverSpans).toEqual(["http.server GET"]);

      for (const path of [
        `${ASSET_ROUTE_PREFIX}-other/file`,
        `${ATTACHMENT_UPLOAD_ROUTE_PREFIX}-other/token`,
      ]) {
        expect((yield* client.execute(HttpClientRequest.get(path))).status).toBe(404);
      }
      expect(serverSpans).toEqual(["http.server GET", "http.server GET", "http.server GET"]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
