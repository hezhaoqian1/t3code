import { PresentationIcon, WandSparklesIcon } from "lucide-react";
import { useState } from "react";

import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

type PresentationActionProps = {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onStart: (prompt: string) => void;
  readonly disabled?: boolean;
};

export function PresentationAction({
  open,
  onOpenChange,
  onStart,
  disabled,
}: PresentationActionProps) {
  const [title, setTitle] = useState("");
  const [audience, setAudience] = useState("客户汇报");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [style, setStyle] = useState("fd-finance");
  const [pages, setPages] = useState("auto");
  const [images, setImages] = useState("source-only");
  const [animation, setAnimation] = useState("subtle");

  const start = () => {
    const pageInstruction = pages === "auto" ? "页数根据材料自动规划" : `控制在 ${pages} 页左右`;
    const styleLabel =
      style === "fd-finance"
        ? "稳重金融（深海军蓝与金色、衬线标题）"
        : style === "executive"
          ? "高管汇报（结论先行、数据密度适中）"
          : "极简（留白优先、清晰层级）";
    const imageLabel =
      images === "source-only"
        ? "只使用用户提供的原始图片"
        : images === "source-and-stock"
          ? "可补充与主题直接相关的素材"
          : "不使用图片，以图表和版式表达";
    const animationLabel = animation === "subtle" ? "使用淡入淡出页切换" : "不使用动画";
    const brief = [
      title.trim() ? `演示文稿主题：${title.trim()}` : "请根据当前任务材料制作演示文稿",
      `使用场景：${audience}`,
      `风格：${styleLabel}`,
      pageInstruction,
      `图片：${imageLabel}`,
      `动画：${animationLabel}`,
      "保持原始材料的逻辑框架与事实，不改变原意；输出可编辑项目并导出 PPTX。",
      "请使用方德演示能力完成内容梳理、页面设计、图表表达和最终导出。",
    ].join("\n");
    onStart(brief);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-xl" bottomStickOnMobile={false}>
        <DialogHeader>
          <div className="flex items-center gap-2 text-primary">
            <PresentationIcon className="size-5" />
            <span className="text-xs font-medium uppercase tracking-wide">方德演示</span>
          </div>
          <DialogTitle>制作 PPT</DialogTitle>
          <DialogDescription>
            把当前任务中的材料整理成可编辑、可继续修改的演示文稿。
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-5">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">主题或用途</span>
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="例如：季度投资策略汇报"
            />
          </label>
          <div className="space-y-2">
            <span className="text-sm font-medium">使用场景</span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {["客户汇报", "内部汇报", "培训课件", "数据分析"].map((option) => (
                <Button
                  key={option}
                  type="button"
                  size="sm"
                  variant={audience === option ? "default" : "outline"}
                  onClick={() => setAudience(option)}
                  className="min-w-0"
                >
                  {option}
                </Button>
              ))}
            </div>
          </div>
          <button
            type="button"
            className="text-sm font-medium text-primary hover:underline"
            onClick={() => setAdvancedOpen((open) => !open)}
            aria-expanded={advancedOpen}
          >
            {advancedOpen ? "收起更多设置" : "更多设置"}
          </button>
          {advancedOpen ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-sm font-medium">视觉风格</span>
                <select
                  className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                  value={style}
                  onChange={(event) => setStyle(event.target.value)}
                >
                  <option value="fd-finance">稳重金融</option>
                  <option value="executive">高管汇报</option>
                  <option value="minimal">极简</option>
                </select>
              </label>
              <label className="space-y-1.5">
                <span className="text-sm font-medium">页数</span>
                <select
                  className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                  value={pages}
                  onChange={(event) => setPages(event.target.value)}
                >
                  <option value="auto">自动规划</option>
                  <option value="8">8 页</option>
                  <option value="12">12 页</option>
                  <option value="16">16 页</option>
                </select>
              </label>
              <label className="space-y-1.5">
                <span className="text-sm font-medium">图片策略</span>
                <select
                  className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                  value={images}
                  onChange={(event) => setImages(event.target.value)}
                >
                  <option value="source-only">只用原始图片</option>
                  <option value="source-and-stock">允许补充素材</option>
                  <option value="no-images">不使用图片</option>
                </select>
              </label>
              <label className="space-y-1.5">
                <span className="text-sm font-medium">页切换</span>
                <select
                  className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                  value={animation}
                  onChange={(event) => setAnimation(event.target.value)}
                >
                  <option value="subtle">淡入淡出</option>
                  <option value="none">无动画</option>
                </select>
              </label>
            </div>
          ) : null}
          <div className="rounded-lg border border-border/70 bg-muted/35 p-3 text-xs leading-relaxed text-muted-foreground">
            <WandSparklesIcon className="mr-1 inline size-3.5 text-primary" />
            会自动读取当前任务附件，先分析结构，再生成页面、图表和可编辑文件。
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button type="button" disabled={disabled} onClick={start}>
            <PresentationIcon />
            开始制作
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
