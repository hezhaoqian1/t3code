# FD multi-model Responses architecture

This document records the implementation boundary for adding Qwen, GLM, and
Kimi to the FD desktop client while preserving the current DeepSeek desktop
experience.

## Decision

Use the existing t3code provider runtime as the product boundary. Keep the
upstream instance lifecycle and adapter contract instead of introducing a
model-specific orchestration loop:

```text
ModelSelection
  -> ProviderInstanceRegistry
  -> Responses/Codex provider instance
  -> CodexAdapter
  -> Codex App Server
  -> Responses-compatible endpoint
```

The model picker changes `ModelSelection.model` only. The provider adapter
continues to own session lifecycle, streaming events, approvals, user input,
tool calls, local Skills, interruption, resume, rollback, attachments, and
usage events. Orchestration and the renderer must not branch on Qwen/GLM/Kimi.

This is the same boundary used by upstream t3code's `ProviderDriver` /
`ProviderInstance` /
`ProviderAdapter` /
`ProviderService` architecture. A new Responses backend is configuration and
capability policy, not a new agent loop.

The historical upstream implementation confirms the intended split: one
`ProviderDriver.create()` owns one independently scoped runtime, snapshot, and
adapter; `ProviderInstanceRegistry` routes by instance id; and
`ProviderService` keeps transport and desktop orchestration provider-agnostic.
The FD fork removed the generic Codex driver while specializing the product,
so this slice keeps `fd-deepseek` as a compatibility driver while reusing the
generic `CodexAdapter` and App Server runtime underneath it. A future cleanup
can add a small dedicated Responses driver without changing the renderer or
orchestration contracts.

## Instance and model identity

`ProviderInstanceId` is an internal routing and credential boundary. The UI
should present a flat model list, while the server keeps the selected instance
on the persisted `ModelSelection`. The current compatibility implementation
keeps the existing `fd-deepseek` instance id so existing threads, resume
cursors, and persisted bindings remain readable:

```ts
{
  instanceId: "fd-deepseek",
  model: "qwen3.8-flash",
  options: []
}
```

The long-term naming can migrate to one generic `fd-model-runtime` instance,
but that is a storage migration rather than a prerequisite for the runtime
design. The current server-side route table maps models to different base URLs
and credentials:

| Model                                  | Backend    | Wire protocol |
| -------------------------------------- | ---------- | ------------- |
| `deepseek-v4-flash`, `deepseek-v4-pro` | FD New API | Responses     |
| `qwen3.8-max`, `qwen3.8-flash`         | DashScope  | Responses     |
| `glm-5.2`                              | DashScope  | Responses     |
| `kimi-k3`                              | DashScope  | Responses     |

The current compatibility route keeps these under the historical
`fd-deepseek` instance id so old threads and resume bindings remain readable.
That instance can select two different endpoint identities, however, so a
model change is treated as a provider-session restart. The desktop thread,
tools, approvals, Skills, and event stream stay the same; only the underlying
App Server process/home is replaced. An in-session switch is safe only when
the model remains on the same endpoint identity. The adapter records and
checks that identity, so a direct call cannot accidentally send a model to the
previous endpoint.

## Server-side configuration

`apps/server/src/fd-codex/ResponsesCodexConfig.ts` is the reusable Codex
Responses configuration writer. It enforces these invariants:

- endpoint URLs are HTTPS or loopback HTTP;
- endpoint URLs contain no credentials, query strings, or fragments;
- the configured path ends in `/v1`;
- the default model exists in the catalog;
- API keys are referenced through an environment variable and never written to
  `config.toml`.

`FdManagedCodexHome.ts` now uses this writer, preserving the current FD
DeepSeek configuration and credential isolation. `ResponsesModelCatalog.ts`
contains the initial DashScope catalog as server-side metadata, and the
catalog is already projected into the provider snapshot and desktop picker.
The provider remains fail-closed when its key or runtime is unavailable; the
full App Server compatibility matrix is still a release gate.

The current development entry point reads `DASHSCOPE_API_KEY` from the server
process environment. Production desktop builds must replace that with a
server-owned `ServerSecretStore` operation: the renderer may receive only
configured/authenticated state and model capabilities. The key must not enter
`ModelSelection`, renderer storage, settings JSON, logs, or `config.toml`.

## Capability policy

Capabilities are model facts, not global assumptions. At minimum the catalog
must control:

- native image input;
- function/tool calls;
- reasoning and accepted effort values;
- structured output;
- forced tool choice;
- parallel tool calls;
- context and output limits.

For DashScope, the current probe indicates that automatic function calling is
available, but forced object/required `tool_choice` can fail in thinking mode.
The runtime therefore defaults to automatic tool choice and must not forward
DeepSeek/OpenAI reasoning options unconditionally. A model without a declared
capability is treated as unsupported rather than guessed at runtime.

## Vision

The composer and server should preserve one attachment semantic. The selected
model decides the route:

```text
image attachment
  -> model capability check
  -> native input_image/localImage when supported
  -> explicit unsupported-model error otherwise
```

`FdVisionService` remains a legacy FD DeepSeek preprocessor and must not become
the default visual path for external models. It may remain available only for
the FD policy that explicitly authorizes it. External models that support
vision should receive their own image input through the same Responses/Codex
transport; they should not silently receive a DeepSeek-generated description.

## Rollout

1. Complete the Codex App Server -> DashScope matrix: text streaming,
   reasoning, automatic tool call plus tool output continuation, usage,
   cancellation, approval, local file tools, resume, rollback, and native
   image input.
2. Add one generic Responses driver/config route with server-owned credentials
   and a model catalog. Keep `fd-deepseek` as a compatibility alias during
   migration. For a model switch that crosses base URLs, the adapter must
   either prove App Server thread resume across those endpoints or explicitly
   restart through a tested history-preserving path; an in-session capability
   flag alone is not sufficient. Until that replay path is proven, the
   compatibility adapter correctly reports model switching as restart-required.
3. Project the catalog into `ServerProvider.models`; remove the DeepSeek-only
   whitelist from the renderer and use server-provided labels/capabilities.
4. Route images by the selected model capability. Keep enterprise Skill turns
   fail-closed for attachments until an audited enterprise vision worker
   exists.
5. Add model-switch, continuation, usage, and DeepSeek regression tests before
   enabling the external models by default.

The important acceptance criterion is not that a model can answer a direct
HTTP request. It is that the existing desktop workflow remains identical when
only `model` changes.
