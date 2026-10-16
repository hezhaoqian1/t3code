import { EditorId, type EnvironmentId, type ResolvedKeybindingsConfig } from "@t3tools/contracts";
import { memo, useCallback, useEffect, useMemo } from "react";
import { isOpenFavoriteEditorShortcut, shortcutLabelForCommand } from "../../keybindings";
import { usePreferredEditor } from "../../editorPreferences";
import { ChevronDownIcon, FolderClosedIcon } from "lucide-react";
import { Button } from "../ui/button";
import { Group, GroupSeparator } from "../ui/group";
import { Menu, MenuItem, MenuPopup, MenuShortcut, MenuTrigger } from "../ui/menu";
import {
  AntigravityIcon,
  CursorIcon,
  Icon,
  KiroIcon,
  TraeIcon,
  VisualStudioCode,
  VisualStudioCodeInsiders,
  VSCodium,
  Zed,
} from "../Icons";
import {
  AquaIcon,
  CLionIcon,
  DataGripIcon,
  DataSpellIcon,
  GoLandIcon,
  IntelliJIdeaIcon,
  PhpStormIcon,
  PyCharmIcon,
  RiderIcon,
  RubyMineIcon,
  RustRoverIcon,
  WebStormIcon,
} from "../JetBrainsIcons";
import { cn, isMacPlatform, isWindowsPlatform } from "~/lib/utils";
import { shellEnvironment } from "~/state/shell";
import { useAtomCommand } from "~/state/use-atom-command";
import { ensureLocalApi } from "~/localApi";
import { toastManager } from "../ui/toast";

type OpenInOption = {
  label: string;
  Icon: Icon;
  value: EditorId;
  kind: "brand" | "generic";
};

const resolveOptions = (platform: string, availableEditors: ReadonlyArray<EditorId>) => {
  const baseOptions: ReadonlyArray<OpenInOption> = [
    {
      label: "Cursor",
      Icon: CursorIcon,
      value: "cursor",
      kind: "brand",
    },
    {
      label: "Trae",
      Icon: TraeIcon,
      value: "trae",
      kind: "brand",
    },
    {
      label: "Kiro",
      Icon: KiroIcon,
      value: "kiro",
      kind: "brand",
    },
    {
      label: "VS Code",
      Icon: VisualStudioCode,
      value: "vscode",
      kind: "brand",
    },
    {
      label: "VS Code Insiders",
      Icon: VisualStudioCodeInsiders,
      value: "vscode-insiders",
      kind: "brand",
    },
    {
      label: "VSCodium",
      Icon: VSCodium,
      value: "vscodium",
      kind: "brand",
    },
    {
      label: "Zed",
      Icon: Zed,
      value: "zed",
      kind: "brand",
    },
    {
      label: "Antigravity",
      Icon: AntigravityIcon,
      value: "antigravity",
      kind: "brand",
    },
    {
      label: "IntelliJ IDEA",
      Icon: IntelliJIdeaIcon,
      value: "idea",
      kind: "brand",
    },
    {
      label: "Aqua",
      Icon: AquaIcon,
      value: "aqua",
      kind: "brand",
    },
    {
      label: "CLion",
      Icon: CLionIcon,
      value: "clion",
      kind: "brand",
    },
    {
      label: "DataGrip",
      Icon: DataGripIcon,
      value: "datagrip",
      kind: "brand",
    },
    {
      label: "DataSpell",
      Icon: DataSpellIcon,
      value: "dataspell",
      kind: "brand",
    },
    {
      label: "GoLand",
      Icon: GoLandIcon,
      value: "goland",
      kind: "brand",
    },
    {
      label: "PhpStorm",
      Icon: PhpStormIcon,
      value: "phpstorm",
      kind: "brand",
    },
    {
      label: "PyCharm",
      Icon: PyCharmIcon,
      value: "pycharm",
      kind: "brand",
    },
    {
      label: "Rider",
      Icon: RiderIcon,
      value: "rider",
      kind: "brand",
    },
    {
      label: "RubyMine",
      Icon: RubyMineIcon,
      value: "rubymine",
      kind: "brand",
    },
    {
      label: "RustRover",
      Icon: RustRoverIcon,
      value: "rustrover",
      kind: "brand",
    },
    {
      label: "WebStorm",
      Icon: WebStormIcon,
      value: "webstorm",
      kind: "brand",
    },
    {
      label: isMacPlatform(platform)
        ? "Finder"
        : isWindowsPlatform(platform)
          ? "Explorer"
          : "Files",
      Icon: FolderClosedIcon,
      value: "file-manager",
      kind: "generic",
    },
  ];
  const availableEditorSet = new Set(availableEditors);
  return baseOptions.filter((option) => availableEditorSet.has(option.value));
};

function getOpenInIconClass(kind: OpenInOption["kind"]) {
  return cn(kind === "brand" ? "text-foreground opacity-100" : "text-muted-foreground");
}

export const OpenInPicker = memo(function OpenInPicker({
  environmentId,
  keybindings,
  availableEditors,
  openInCwd,
  compact = false,
  enableShortcut = true,
  folderOnly = false,
}: {
  environmentId: EnvironmentId;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  openInCwd: string | null;
  compact?: boolean;
  enableShortcut?: boolean;
  folderOnly?: boolean;
}) {
  const openInEditorMutation = useAtomCommand(shellEnvironment.openInEditor, "open in editor");
  const effectiveEditors = useMemo(
    () =>
      folderOnly
        ? ["file-manager" as const]
        : window.desktopBridge
          ? Array.from(new Set([...availableEditors, "file-manager" as const]))
          : availableEditors,
    [availableEditors, folderOnly],
  );
  const [preferredEditor, setPreferredEditor] = usePreferredEditor(effectiveEditors);
  const options = useMemo(
    () => resolveOptions(navigator.platform, effectiveEditors),
    [effectiveEditors],
  );
  const primaryOption = options.find(({ value }) => value === preferredEditor) ?? null;

  const openInEditor = useCallback(
    async (editorId: EditorId | null) => {
      if (!openInCwd) return;
      const editor = editorId ?? preferredEditor;
      if (!editor) return;
      if (editor === "file-manager" && window.desktopBridge) {
        try {
          await ensureLocalApi().shell.openPath(openInCwd);
          if (!folderOnly) setPreferredEditor(editor);
        } catch {
          toastManager.add({
            type: "error",
            title: "无法打开文件夹",
            description: `请确认目录仍然存在且有访问权限：${openInCwd}`,
          });
        }
        return;
      }
      const result = openInEditorMutation({
        environmentId,
        input: {
          cwd: openInCwd,
          editor,
        },
      });
      setPreferredEditor(editor);
      return result;
    },
    [
      environmentId,
      openInCwd,
      openInEditorMutation,
      preferredEditor,
      setPreferredEditor,
      folderOnly,
    ],
  );

  const openFavoriteEditorShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, "editor.openFavorite"),
    [keybindings],
  );

  useEffect(() => {
    if (!enableShortcut) return;
    const handler = (e: globalThis.KeyboardEvent) => {
      if (!isOpenFavoriteEditorShortcut(e, keybindings)) return;
      if (!openInCwd) return;
      if (!preferredEditor) return;

      e.preventDefault();
      void openInEditor(preferredEditor);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [enableShortcut, keybindings, openInCwd, openInEditor, preferredEditor]);

  if (folderOnly) {
    return (
      <Button
        aria-label="打开文件夹"
        title="打开任务文件夹"
        size="xs"
        variant="outline"
        disabled={!openInCwd}
        onClick={() => void openInEditor("file-manager")}
      >
        <FolderClosedIcon aria-hidden="true" className="size-3.5" />
        <span className="hidden @3xl/header-actions:inline">打开文件夹</span>
      </Button>
    );
  }

  return (
    <Group aria-label="在编辑器中打开">
      <Button
        aria-label={compact ? "在首选编辑器中打开文件" : undefined}
        className="ps-[8.5px]"
        size="xs"
        variant="outline"
        disabled={!preferredEditor || !openInCwd}
        onClick={() => openInEditor(preferredEditor)}
      >
        {primaryOption?.Icon && (
          <primaryOption.Icon
            aria-hidden="true"
            className={cn("size-3.5", getOpenInIconClass(primaryOption.kind))}
          />
        )}
        <span
          className={
            compact
              ? "sr-only"
              : "sr-only @3xl/header-actions:not-sr-only @3xl/header-actions:ml-0.5"
          }
        >
          打开
        </span>
      </Button>
      <GroupSeparator {...(!compact ? { className: "hidden @3xl/header-actions:block" } : {})} />
      <Menu>
        <MenuTrigger
          render={
            <Button
              aria-label={compact ? "选择编辑器" : "打开选项"}
              size="icon-xs"
              variant="outline"
            />
          }
        >
          <ChevronDownIcon aria-hidden="true" className="size-4" />
        </MenuTrigger>
        <MenuPopup align="end">
          {options.length === 0 && <MenuItem disabled>未找到已安装的编辑器</MenuItem>}
          {options.map(({ label, Icon, value, kind }) => (
            <MenuItem key={value} onClick={() => openInEditor(value)}>
              <Icon aria-hidden="true" className={getOpenInIconClass(kind)} />
              {label}
              {value === preferredEditor && openFavoriteEditorShortcutLabel && (
                <MenuShortcut>{openFavoriteEditorShortcutLabel}</MenuShortcut>
              )}
            </MenuItem>
          ))}
        </MenuPopup>
      </Menu>
    </Group>
  );
});
