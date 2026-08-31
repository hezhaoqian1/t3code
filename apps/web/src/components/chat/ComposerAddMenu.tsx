import {
  AtSignIcon,
  FileTextIcon,
  ImagePlusIcon,
  PlugZapIcon,
  PlusIcon,
  ShieldCheckIcon,
  SparklesIcon,
  SquareTerminalIcon,
  PresentationIcon,
} from "lucide-react";
import { memo } from "react";

import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";

export type ComposerConnectorState = {
  readonly available: boolean;
  readonly status: "checking" | "connected" | "disconnected";
};

export const ComposerAddMenu = memo(function ComposerAddMenu(props: {
  readonly disabled?: boolean;
  readonly imageDisabled?: boolean;
  readonly documentAvailable?: boolean;
  readonly documentDisabled?: boolean;
  readonly fdSkillsDisabled?: boolean;
  readonly connectorState: ComposerConnectorState;
  readonly onAddImages: () => void;
  readonly onAddDocuments: () => void;
  readonly onOpenFiles: () => void;
  readonly onOpenTerminal: () => void;
  readonly onOpenFdSkills: () => void;
  readonly onOpenLocalSkills: () => void;
  readonly onOpenConnectors: () => void;
  readonly onOpenPresentation: () => void;
}) {
  const connectorDescription = props.connectorState.available
    ? props.connectorState.status === "connected"
      ? "飞书已连接，Agent 自动可用"
      : props.connectorState.status === "checking"
        ? "正在同步飞书连接状态…"
        : "飞书未连接，点击前往连接"
    : "连接器仅在桌面端可用";

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            disabled={props.disabled}
            className="size-8 shrink-0 rounded-full border border-border/70 bg-background/55 text-foreground shadow-sm hover:bg-accent"
            aria-label="添加内容和能力"
            title="添加内容和能力"
          />
        }
      >
        <PlusIcon className="size-4" aria-hidden="true" />
      </MenuTrigger>
      <MenuPopup
        align="start"
        side="top"
        sideOffset={8}
        className="w-72 rounded-xl border border-border/80 bg-popover/98 shadow-2xl"
      >
        <div className="px-2 pb-1 pt-1.5">
          <div className="text-xs font-semibold text-foreground">添加到当前任务</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">引用文件、能力或外部连接器</div>
        </div>

        <MenuItem disabled={props.imageDisabled} onClick={props.onAddImages}>
          <ImagePlusIcon />
          <span className="min-w-0 flex-1">
            <span className="block">添加图片</span>
            <span className="block text-[11px] text-muted-foreground">上传图片作为任务附件</span>
          </span>
        </MenuItem>
        {props.documentAvailable ? (
          <MenuItem disabled={props.documentDisabled} onClick={props.onAddDocuments}>
            <FileTextIcon />
            <span className="min-w-0 flex-1">
              <span className="block">添加文件</span>
              <span className="block text-[11px] text-muted-foreground">
                分析 PDF、PPTX、DOCX、XLSX 或文本
              </span>
            </span>
          </MenuItem>
        ) : null}
        <MenuItem onClick={props.onOpenFiles}>
          <AtSignIcon />
          <span className="min-w-0 flex-1">
            <span className="block">引用工作区文件</span>
            <span className="block text-[11px] text-muted-foreground">搜索并插入 @ 文件引用</span>
          </span>
        </MenuItem>
        <MenuItem onClick={props.onOpenPresentation}>
          <PresentationIcon />
          <span className="min-w-0 flex-1">
            <span className="block">制作 PPT</span>
            <span className="block text-[11px] text-muted-foreground">
              将当前材料整理为可编辑演示文稿
            </span>
          </span>
        </MenuItem>
        <MenuItem onClick={props.onOpenTerminal}>
          <SquareTerminalIcon />
          <span className="min-w-0 flex-1">
            <span className="block">终端上下文</span>
            <span className="block text-[11px] text-muted-foreground">打开终端并引用运行结果</span>
          </span>
        </MenuItem>

        <MenuSeparator />

        <MenuItem disabled={props.fdSkillsDisabled} onClick={props.onOpenFdSkills}>
          <ShieldCheckIcon />
          <span className="min-w-0 flex-1">
            <span className="block">FD Skills</span>
            <span className="block text-[11px] text-muted-foreground">选择企业授权的业务能力</span>
          </span>
        </MenuItem>
        <MenuItem onClick={props.onOpenLocalSkills}>
          <SparklesIcon />
          <span className="min-w-0 flex-1">
            <span className="block">本地 Skills</span>
            <span className="block text-[11px] text-muted-foreground">搜索并插入 $ Skill</span>
          </span>
        </MenuItem>

        <MenuSeparator />

        <MenuItem onClick={props.onOpenConnectors}>
          <PlugZapIcon />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span>连接器</span>
              {props.connectorState.status === "connected" ? (
                <span className="rounded-full bg-emerald-500/12 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                  已连接
                </span>
              ) : null}
            </span>
            <span className="block text-[11px] text-muted-foreground">{connectorDescription}</span>
          </span>
        </MenuItem>

        <div className="mx-1 mt-1 rounded-lg bg-muted/55 px-2.5 py-2 text-[10px] leading-relaxed text-muted-foreground">
          连接器授权后会自动提供给 Agent，无需每次手动选择。
        </div>
      </MenuPopup>
    </Menu>
  );
});
