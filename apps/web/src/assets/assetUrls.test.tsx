// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";

const state = vi.hoisted(() => ({
  result: { _tag: "Failure" } as { _tag: string; value?: { relativeUrl: string } },
  refresh: vi.fn(),
  atom: {},
}));
vi.mock("@effect/atom-react", () => ({
  useAtomValue: () => state.result,
  useAtomRefresh: () => state.refresh,
}));
vi.mock("~/state/assets", () => ({ assetEnvironment: { createUrl: () => state.atom } }));
vi.mock("~/state/session", () => ({
  usePreparedConnection: () => ({ _tag: "Some", value: { httpBaseUrl: "http://127.0.0.1:1234" } }),
}));
import { useAssetUrlState } from "./assetUrls";

const element = document.createElement("div");
let root = createRoot(element);
afterEach(async () => {
  await act(async () => root.unmount());
  root = createRoot(element);
  vi.unstubAllGlobals();
  state.refresh.mockClear();
  state.result = { _tag: "Failure" };
});
function Image({ finished }: { finished: boolean }) {
  const result = useAssetUrlState(
    EnvironmentId.make("test"),
    {
      _tag: "workspace-file",
      threadId: ThreadId.make("thread"),
      path: "generated.svg",
    },
    finished,
  );
  return <span>{result._tag === "Success" ? result.url : result._tag}</span>;
}
async function render(finished: boolean) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await act(async () => root.render(<Image finished={finished} />));
}

it("rechecks a cached miss when the answer finishes and shows the newly created image", async () => {
  await render(false);
  expect(state.refresh).not.toHaveBeenCalled();
  await render(true);
  expect(state.refresh).toHaveBeenCalledTimes(1);
  state.result = { _tag: "Success", value: { relativeUrl: "/api/assets/generated.svg" } };
  await render(true);
  expect(element.textContent).toBe("http://127.0.0.1:1234/api/assets/generated.svg");
  expect(state.refresh).toHaveBeenCalledTimes(1);
});

it("does not loop when the file is still missing", async () => {
  await render(true);
  state.result = { _tag: "Initial" };
  await render(true);
  state.result = { _tag: "Failure" };
  await render(true);
  expect(element.textContent).toBe("Failure");
  expect(state.refresh).toHaveBeenCalledTimes(1);
});

it("keeps a successful signed URL cached", async () => {
  state.result = { _tag: "Success", value: { relativeUrl: "/api/assets/generated.svg" } };
  await render(true);
  expect(state.refresh).not.toHaveBeenCalled();
});
