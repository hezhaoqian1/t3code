import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { DesktopEnvironmentBootstrapSchema } from "./ipc.ts";

describe("DesktopEnvironmentBootstrapSchema", () => {
  const decode = Schema.decodeUnknownSync(DesktopEnvironmentBootstrapSchema);

  it("decodes the primary loopback bootstrap", () => {
    expect(
      decode({
        id: "primary",
        label: "Local environment",
        generation: "pid:4102",
        httpBaseUrl: "http://127.0.0.1:3774/",
        wsBaseUrl: "ws://127.0.0.1:3774/",
        bootstrapToken: "bootstrap-token",
      }),
    ).toEqual({
      id: "primary",
      label: "Local environment",
      generation: "pid:4102",
      httpBaseUrl: "http://127.0.0.1:3774/",
      wsBaseUrl: "ws://127.0.0.1:3774/",
      bootstrapToken: "bootstrap-token",
    });
  });

  it("does not project retired environment metadata", () => {
    expect(
      decode({
        id: "primary",
        label: "Local environment",
        generation: "pending",
        runningDistro: "Ubuntu",
        httpBaseUrl: null,
        wsBaseUrl: null,
      }),
    ).toEqual({
      id: "primary",
      label: "Local environment",
      generation: "pending",
      httpBaseUrl: null,
      wsBaseUrl: null,
    });
  });
});
