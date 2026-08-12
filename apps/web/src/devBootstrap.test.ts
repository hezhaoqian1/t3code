import { describe, expect, it } from "vite-plus/test";

import { prepareViteDevelopmentBootstrap } from "./devBootstrap";

describe("prepareViteDevelopmentBootstrap", () => {
  it("exposes the ephemeral credential only to the Vite development server", () => {
    const environment = {
      VITE_T3CODE_DEV_BOOTSTRAP_TOKEN: " ephemeral-development-bootstrap ",
    };
    expect(
      prepareViteDevelopmentBootstrap({
        command: "serve",
        enabled: true,
        environment,
      }),
    ).toEqual({
      "import.meta.env.VITE_T3CODE_DEV_BOOTSTRAP_TOKEN": '"ephemeral-development-bootstrap"',
    });
    expect(environment.VITE_T3CODE_DEV_BOOTSTRAP_TOKEN).toContain(
      "ephemeral-development-bootstrap",
    );
  });

  it("removes the development-only identifier and value from production build inputs", () => {
    const environment: Record<string, string | undefined> = {
      VITE_T3CODE_DEV_BOOTSTRAP_TOKEN: "fixed-inherited-secret",
    };
    const define = prepareViteDevelopmentBootstrap({
      command: "build",
      enabled: true,
      environment,
    });

    expect(define).toEqual({});
    expect(environment).not.toHaveProperty("VITE_T3CODE_DEV_BOOTSTRAP_TOKEN");
    expect(JSON.stringify({ define, environment })).not.toContain(
      "VITE_T3CODE_DEV_BOOTSTRAP_TOKEN",
    );
    expect(JSON.stringify({ define, environment })).not.toContain("fixed-inherited-secret");
  });

  it("requires the positive dev-runner marker", () => {
    expect(
      prepareViteDevelopmentBootstrap({
        command: "serve",
        enabled: false,
        environment: { VITE_T3CODE_DEV_BOOTSTRAP_TOKEN: "fixed-inherited-secret" },
      }),
    ).toEqual({ "import.meta.env.VITE_T3CODE_DEV_BOOTSTRAP_TOKEN": '""' });
  });
});
