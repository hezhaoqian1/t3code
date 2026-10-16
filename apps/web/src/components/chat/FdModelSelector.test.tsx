import {
  FD_RUNTIME_DEFAULT_MODEL,
  FD_RUNTIME_PRO_MODEL,
} from "@t3tools/contracts/fd/runtime-credentials";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  FdModelSelector,
  fdModelLabel,
  resolveFdModelChange,
  resolveFdModelOptions,
} from "./FdModelSelector";

const models = [
  {
    slug: FD_RUNTIME_DEFAULT_MODEL,
    name: "DeepSeek V4 Flash",
    shortName: "V4 Flash",
    isCustom: false,
    isDefault: true,
    capabilities: { optionDescriptors: [] },
  },
  {
    slug: FD_RUNTIME_PRO_MODEL,
    name: "DeepSeek V4 Pro",
    shortName: "V4 Pro",
    isCustom: false,
    isDefault: false,
    capabilities: { optionDescriptors: [] },
  },
] as const;

describe("FdModelSelector", () => {
  it("does not disguise a removed model as Flash and allows switching to the only remaining model", () => {
    const markup = renderToStaticMarkup(
      <FdModelSelector value="qwen3.8-max" models={[models[0]]} onValueChange={vi.fn()} />,
    );
    expect(markup).toContain("请选择模型");
    expect(markup).not.toContain("qwen3.8-max");
    expect(markup).not.toContain('data-disabled=""');
    expect(markup).not.toContain('disabled=""');
    expect(resolveFdModelOptions([models[0]])).toEqual([FD_RUNTIME_DEFAULT_MODEL]);
  });

  it("disables selection when the backend has no available models", () => {
    const markup = renderToStaticMarkup(
      <FdModelSelector value="qwen3.8-max" models={[]} onValueChange={vi.fn()} />,
    );
    expect(markup).toContain('data-disabled=""');
    expect(markup).not.toContain("qwen3.8-max");
  });
  it("keeps every advertised model in provider order", () => {
    expect(
      resolveFdModelOptions([...models, { ...models[0], slug: "other-model", name: "Other" }]),
    ).toEqual([FD_RUNTIME_DEFAULT_MODEL, FD_RUNTIME_PRO_MODEL, "other-model"]);
  });

  it("renders the compact selected-model trigger", () => {
    const markup = renderToStaticMarkup(
      <FdModelSelector value={FD_RUNTIME_PRO_MODEL} models={models} onValueChange={vi.fn()} />,
    );

    expect(markup).toContain('data-fd-model-selector="true"');
    expect(markup).toContain("w-24");
    expect(markup).toContain("min-w-24");
    expect(markup).toContain("V4 Pro");
    expect(fdModelLabel(models[0])).toBe("V4 Flash");
  });

  it("accepts only advertised model changes", () => {
    const options = resolveFdModelOptions(models);

    expect(resolveFdModelChange(FD_RUNTIME_PRO_MODEL, options)).toBe(FD_RUNTIME_PRO_MODEL);
    expect(resolveFdModelChange("other-model", options)).toBeNull();
    expect(resolveFdModelChange(null, options)).toBeNull();
    expect(resolveFdModelChange(FD_RUNTIME_PRO_MODEL, [FD_RUNTIME_DEFAULT_MODEL])).toBeNull();
  });
});
