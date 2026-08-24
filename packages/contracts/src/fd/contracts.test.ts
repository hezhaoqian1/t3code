import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import * as PublicContracts from "../index.ts";
import { FdAccountLoginResponse, FdAccountState } from "./index.ts";
import {
  FD_RUNTIME_MODELS,
  FdRuntimeCredentialCommand,
  FdServerRuntimeCredentialProjection,
} from "./runtimeCredentials.ts";

describe("FD account contracts", () => {
  it("accepts every public account state without credential material", () => {
    const decode = Schema.decodeUnknownSync(FdAccountState);
    expect(decode({ status: "checking" })).toEqual({ status: "checking" });
    expect(decode({ status: "anonymous" })).toEqual({ status: "anonymous" });
    expect(
      decode({
        status: "authenticated",
        policyVersion: 1,
        profile: { id: 31, username: "employee", displayName: "方德员工" },
        capabilities: { generalAssistant: true },
        expiresAt: 2_000_000_000,
      }),
    ).toMatchObject({ status: "authenticated", profile: { id: 31 } });
    expect(
      Schema.decodeUnknownSync(FdAccountState)({
        status: "authenticated",
        policyVersion: 1,
        profile: { id: 31, username: "employee", displayName: null },
        capabilities: { generalAssistant: true },
        expiresAt: 2_000_000_000,
      }),
    ).not.toHaveProperty("model");
    expect(
      decode({
        status: "revocation_pending",
        message: "远程退出尚未完成，请联网后重试。",
        retryAllowed: true,
      }),
    ).toMatchObject({ status: "revocation_pending" });

    for (const secretField of [
      "accessToken",
      "refreshCookie",
      "runtimeApiKey",
      "runtimeTokenId",
      "password",
    ]) {
      expect(() =>
        decode({
          status: "authenticated",
          policyVersion: 1,
          profile: { id: 31, username: "employee", displayName: null },
          capabilities: { generalAssistant: true },
          expiresAt: 2_000_000_000,
          [secretField]: "secret",
        }),
      ).toThrow();
    }
  });

  it("keeps login failures renderer-safe", () => {
    const decode = Schema.decodeUnknownSync(FdAccountLoginResponse);
    expect(
      decode({
        ok: false,
        code: "service_unavailable",
        message: "企业 AI 服务暂时不可用",
      }),
    ).toMatchObject({ ok: false, code: "service_unavailable" });
    expect(() =>
      decode({
        ok: false,
        code: "service_unavailable",
        message: "企业 AI 服务暂时不可用",
        accessToken: "secret",
      }),
    ).toThrow();
  });
});

describe("FD runtime credential contracts", () => {
  const projection = {
    userId: 31,
    runtimeTokenId: 41,
    newApiOrigin: "https://ai-api.fdsure.com",
    runtimeApiKey: "sk-runtime-secret",
    accessToken: "access-secret",
    accessExpiresAt: 2_000_000_000,
    policy: {
      version: 1,
      capability: "general_assistant",
      model: "deepseek-v4-flash",
      expiresAt: 2_000_000_000,
    },
    generation: 7,
  } as const;

  it("keeps credential schemas off the renderer-facing contracts barrel", () => {
    expect(PublicContracts).not.toHaveProperty("FdRuntimeCredentialCommand");
    expect(PublicContracts).not.toHaveProperty("FdServerRuntimeCredentialProjection");
    expect(PublicContracts).not.toHaveProperty("FD_RUNTIME_CREDENTIAL_MAX_LINE_BYTES");
  });

  it("accepts only the minimum server projection", () => {
    expect(Schema.decodeUnknownSync(FdServerRuntimeCredentialProjection)(projection)).toEqual(
      projection,
    );
    for (const secretField of ["refreshCookie", "password", "sessionId"]) {
      expect(() =>
        Schema.decodeUnknownSync(FdServerRuntimeCredentialProjection)({
          ...projection,
          [secretField]: "forbidden",
        }),
      ).toThrow();
    }
  });

  it("keeps the exact model policy server-authoritative and versioned", () => {
    const decode = Schema.decodeUnknownSync(FdServerRuntimeCredentialProjection);
    expect(decode(projection).policy).toEqual({
      version: 1,
      capability: "general_assistant",
      model: "deepseek-v4-flash",
      expiresAt: 2_000_000_000,
    });
    expect(
      decode({
        ...projection,
        policy: { ...projection.policy, models: FD_RUNTIME_MODELS },
      }).policy.models,
    ).toEqual(["deepseek-v4-flash", "deepseek-v4-pro", "deepseek-v4-flash-vision-exp"]);
    expect(
      decode({
        ...projection,
        policy: {
          ...projection.policy,
          models: ["deepseek-v4-flash", "deepseek-v4-pro"],
        },
      }).policy.models,
    ).toEqual(["deepseek-v4-flash", "deepseek-v4-pro"]);
    expect(() =>
      decode({
        ...projection,
        policy: { ...projection.policy, model: "deepseek-v4" },
      }),
    ).toThrow();
    expect(() =>
      decode({
        ...projection,
        policy: { ...projection.policy, models: ["deepseek-v4-flash", "gpt-5"] },
      }),
    ).toThrow();
  });

  it("accepts only bounded HTTPS or loopback HTTP(S) origins", () => {
    const decode = Schema.decodeUnknownSync(FdServerRuntimeCredentialProjection);
    expect(decode(projection).newApiOrigin).toBe("https://ai-api.fdsure.com");
    expect(decode({ ...projection, newApiOrigin: "http://127.0.0.1:3001" }).newApiOrigin).toBe(
      "http://127.0.0.1:3001",
    );
    for (const newApiOrigin of [
      "http://ai-api.fdsure.com",
      "https://user:password@ai-api.fdsure.com",
      "https://ai-api.fdsure.com/path",
      "https://ai-api.fdsure.com?token=secret",
    ]) {
      expect(() => decode({ ...projection, newApiOrigin })).toThrow();
    }
  });

  it("decodes versioned set and clear NDJSON commands", () => {
    const decode = Schema.decodeUnknownSync(FdRuntimeCredentialCommand);
    expect(decode({ version: 1, type: "set", credentials: projection })).toMatchObject({
      type: "set",
    });
    expect(decode({ version: 1, type: "clear", generation: 8 })).toEqual({
      version: 1,
      type: "clear",
      generation: 8,
    });
    expect(() => decode({ version: 2, type: "clear", generation: 9 })).toThrow();
  });
});
