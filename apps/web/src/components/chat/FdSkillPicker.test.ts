import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId, type ServerProviderSkill } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { useComposerDraftStore } from "../../composerDraftStore";
import { useFdSkillSelectionStore } from "../../fdSkillSelectionStore";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import {
  FdSkillPicker,
  MAX_VISIBLE_FD_SKILLS,
  clearRevokedFdSkillSelection,
  mergeBusinessCapabilities,
  partitionBusinessCapabilities,
  resolveProviderSkillCatalogState,
  shouldClearRevokedFdSkillSelection,
} from "./FdSkillPicker.tsx";

const threadId = ThreadId.make("thread-revoked-fd-skill");
const threadRef = scopeThreadRef(EnvironmentId.make("fd-skill-picker-test"), threadId);

const availableSkill = {
  name: "enterprise-search",
  path: "fd-managed://10004",
  scope: "fd-managed",
  enabled: true,
} satisfies ServerProviderSkill;

const localSkill = {
  name: "summarize-documents",
  displayName: "文档总结",
  path: "/skills/summarize-documents/SKILL.md",
  scope: "user",
  enabled: true,
} satisfies ServerProviderSkill;

describe("clearRevokedFdSkillSelection", () => {
  beforeEach(() => {
    useFdSkillSelectionStore.setState({ selectedByThread: {} });
    useComposerDraftStore.setState({
      draftsByThreadKey: {},
      draftThreadsByThreadKey: {},
      logicalProjectDraftThreadKeyByLogicalProjectKey: {},
      stickyModelSelectionByProvider: {},
      stickyActiveProvider: null,
    });
  });

  it("clears the selected version and sensitive draft after catalog revocation", () => {
    useFdSkillSelectionStore.getState().select(threadId, 10004);
    useComposerDraftStore.getState().setPrompt(threadRef, "查询企业敏感信息");

    expect(
      clearRevokedFdSkillSelection({
        threadId,
        selectedVersionId: 10004,
        skills: [availableSkill],
        providerCatalogState: "ready",
      }),
    ).toBe(false);
    expect(useFdSkillSelectionStore.getState().selectedByThread[threadId]).toBe(10004);

    expect(
      clearRevokedFdSkillSelection({
        threadId,
        selectedVersionId: 10004,
        skills: [],
        providerCatalogState: "ready",
      }),
    ).toBe(true);
    expect(useFdSkillSelectionStore.getState().selectedByThread[threadId]).toBeUndefined();
    expect(Object.values(useComposerDraftStore.getState().draftsByThreadKey)).not.toContainEqual(
      expect.objectContaining({ prompt: "查询企业敏感信息" }),
    );
  });

  it.each(["loading", "error"] as const)(
    "preserves selection and draft while the provider catalog is %s",
    (providerCatalogState) => {
      useFdSkillSelectionStore.getState().select(threadId, 10004);
      useComposerDraftStore.getState().setPrompt(threadRef, "保留企业查询草稿");

      expect(
        clearRevokedFdSkillSelection({
          threadId,
          selectedVersionId: 10004,
          skills: [],
          providerCatalogState,
        }),
      ).toBe(false);
      expect(useFdSkillSelectionStore.getState().selectedByThread[threadId]).toBe(10004);
      expect(Object.values(useComposerDraftStore.getState().draftsByThreadKey)).toContainEqual(
        expect.objectContaining({ prompt: "保留企业查询草稿" }),
      );
    },
  );
});

describe("shouldClearRevokedFdSkillSelection", () => {
  it("revokes from a ready provider snapshot without depending on the local catalog", () => {
    expect(
      shouldClearRevokedFdSkillSelection({
        selectedVersionId: 10004,
        skills: [],
        providerCatalogState: "ready",
      }),
    ).toBe(true);
  });

  it.each(["loading", "error"] as const)(
    "preserves selection while the provider catalog is %s",
    (providerCatalogState) => {
      expect(
        shouldClearRevokedFdSkillSelection({
          selectedVersionId: 10004,
          skills: [],
          providerCatalogState,
        }),
      ).toBe(false);
    },
  );
});

describe("resolveProviderSkillCatalogState", () => {
  it("prefers the independent catalog state over provider runtime readiness", () => {
    expect(resolveProviderSkillCatalogState({ status: "ready", skillCatalogState: "error" })).toBe(
      "error",
    );
    expect(resolveProviderSkillCatalogState({ status: "error", skillCatalogState: "ready" })).toBe(
      "ready",
    );
  });

  it("keeps older provider snapshots compatible", () => {
    expect(resolveProviderSkillCatalogState(null)).toBe("loading");
    expect(resolveProviderSkillCatalogState({ status: "ready" })).toBe("ready");
    expect(resolveProviderSkillCatalogState({ status: "error" })).toBe("error");
  });
});

describe("FdSkillPicker", () => {
  it("keeps provider-managed skills and uses the scoped catalog for local skills", () => {
    const providerLocalSkill = { ...localSkill, path: "/global/provider/SKILL.md" };
    const projectLocalSkill = {
      ...localSkill,
      description: "project override",
      path: "/project/.agents/skills/summarize-documents/SKILL.md",
      scope: "project:agents",
    };
    const anotherProjectSkill = {
      ...localSkill,
      name: "project-only",
      path: "/project/.codex/skills/project-only/SKILL.md",
      scope: "project:codex-compat",
    };

    expect(
      mergeBusinessCapabilities(
        [availableSkill, providerLocalSkill],
        [projectLocalSkill, anotherProjectSkill, { ...anotherProjectSkill }],
      ),
    ).toEqual([availableSkill, projectLocalSkill, anotherProjectSkill]);
  });

  it("keeps only the first four authorized FD Skills visible", () => {
    const fdSkills = Array.from({ length: 5 }, (_, index) => ({
      ...availableSkill,
      name: `fd-skill-${index + 1}`,
      path: `fd-managed://${10004 + index}`,
    }));
    const partitioned = partitionBusinessCapabilities([
      ...fdSkills,
      localSkill,
      { ...localSkill, name: "disabled", enabled: false },
    ]);

    expect(MAX_VISIBLE_FD_SKILLS).toBe(4);
    expect(partitioned.fdSkills).toEqual(fdSkills.slice(0, 4));
    expect(partitioned.localSkills).toEqual([localSkill]);
  });

  it("renders only the FD Skills entry point", () => {
    const markup = renderToStaticMarkup(
      createElement(FdSkillPicker, {
        threadId,
        skills: [availableSkill, localSkill],
      }),
    );

    expect(markup).toContain("FD Skills");
    expect(markup).not.toContain("业务能力");
    expect(markup).not.toContain("本地能力");
    expect(markup).not.toContain("Provider");
  });
});
