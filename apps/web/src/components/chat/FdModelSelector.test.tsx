import {
  FD_RUNTIME_DEFAULT_MODEL,
  FD_RUNTIME_PRO_MODEL,
} from "@t3tools/contracts/fd/runtime-credentials";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { FdModelSelector, fdModelLabel, resolveFdModelOptions } from "./FdModelSelector";

const models = [
  {
    slug: FD_RUNTIME_DEFAULT_MODEL,
    name: "DeepSeek V4 Flash",
    isCustom: false,
    isDefault: true,
    capabilities: { optionDescriptors: [] },
  },
  {
    slug: FD_RUNTIME_PRO_MODEL,
    name: "DeepSeek V4 Pro",
    isCustom: false,
    isDefault: false,
    capabilities: { optionDescriptors: [] },
  },
] as const;

describe("FdModelSelector", () => {
  it("keeps only exact managed models in provider order", () => {
    expect(
      resolveFdModelOptions([...models, { ...models[0], slug: "other-model", name: "Other" }]),
    ).toEqual([FD_RUNTIME_DEFAULT_MODEL, FD_RUNTIME_PRO_MODEL]);
  });

  it("renders the compact selected-model trigger", () => {
    const markup = renderToStaticMarkup(
      <FdModelSelector value={FD_RUNTIME_PRO_MODEL} models={models} onValueChange={vi.fn()} />,
    );

    expect(markup).toContain('data-fd-model-selector="true"');
    expect(markup).toContain("V4 Pro");
    expect(fdModelLabel(FD_RUNTIME_DEFAULT_MODEL)).toBe("V4 Flash");
  });
});
