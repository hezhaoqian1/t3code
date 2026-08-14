import { useRef } from "react";
import type { SourceControlWritingStyleMode } from "@t3tools/contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";

import { usePrimarySettings, useUpdatePrimarySettings } from "../../hooks/useSettings";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { SettingResetButton, SettingsRow, SettingsSection } from "./settingsLayout";

const MODE_OPTIONS: Record<SourceControlWritingStyleMode, { label: string; description: string }> =
  {
    repo_conventions: {
      label: "仓库约定",
      description: "在每个项目中参考近期的变更说明和变更请求标题。",
    },
    conventional_commits: {
      label: "约定式提交",
      description: "变更说明使用约定式提交前缀，变更请求标题和描述保持简洁。",
    },
    custom: {
      label: "自定义说明",
      description: "在每个项目的变更说明、变更请求标题和描述中应用你的自定义要求。",
    },
  };

export function SourceControlWritingSettingsSection() {
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const customInstructionsRef = useRef<HTMLTextAreaElement>(null);
  const style = settings.sourceControlWritingStyle;
  const defaults = DEFAULT_UNIFIED_SETTINGS.sourceControlWritingStyle;
  const isSourceControlWritingStyleDirty =
    style.mode !== defaults.mode || style.customInstructions !== defaults.customInstructions;

  return (
    <SettingsSection title="文本生成">
      <SettingsRow
        title="版本控制文案风格"
        description={MODE_OPTIONS[style.mode].description}
        resetAction={
          isSourceControlWritingStyleDirty ? (
            <SettingResetButton
              label="版本控制文案风格"
              onClick={() =>
                updateSettings({
                  sourceControlWritingStyle: {
                    mode: defaults.mode,
                    customInstructions: defaults.customInstructions,
                  },
                })
              }
            />
          ) : null
        }
        control={
          <Select
            value={style.mode}
            onValueChange={(value) => {
              const customInstructions = customInstructionsRef.current?.value.trim();
              updateSettings({
                sourceControlWritingStyle: {
                  mode: value as SourceControlWritingStyleMode,
                  ...(customInstructions !== undefined ? { customInstructions } : {}),
                },
              });
            }}
          >
            <SelectTrigger className="w-full sm:w-56" aria-label="版本控制文案风格">
              <SelectValue>{MODE_OPTIONS[style.mode].label}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {(Object.keys(MODE_OPTIONS) as SourceControlWritingStyleMode[]).map((mode) => (
                <SelectItem key={mode} hideIndicator value={mode}>
                  {MODE_OPTIONS[mode].label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      >
        {style.mode === "custom" ? (
          <div className="mt-3 max-w-2xl pb-3.5">
            <Textarea
              key={style.customInstructions}
              ref={customInstructionsRef}
              defaultValue={style.customInstructions}
              onBlur={(event) => {
                const customInstructions = event.target.value.trim();
                if (customInstructions !== style.customInstructions) {
                  updateSettings({ sourceControlWritingStyle: { customInstructions } });
                }
              }}
              rows={4}
              placeholder="例如：标题保持简洁，描述使用短句要点。"
              aria-label="自定义版本控制文案说明"
            />
          </div>
        ) : null}
      </SettingsRow>

      <SettingsRow
        title="遵循变更请求模板"
        description="如果当前仓库提供模板，就按模板组织变更请求描述。"
        resetAction={
          style.followChangeRequestTemplates !== defaults.followChangeRequestTemplates ? (
            <SettingResetButton
              label="变更请求模板"
              onClick={() =>
                updateSettings({
                  sourceControlWritingStyle: {
                    followChangeRequestTemplates: defaults.followChangeRequestTemplates,
                  },
                })
              }
            />
          ) : null
        }
        control={
          <Switch
            checked={style.followChangeRequestTemplates}
            onCheckedChange={(checked) =>
              updateSettings({
                sourceControlWritingStyle: {
                  followChangeRequestTemplates: Boolean(checked),
                },
              })
            }
            aria-label="遵循变更请求模板"
          />
        }
      />
    </SettingsSection>
  );
}
