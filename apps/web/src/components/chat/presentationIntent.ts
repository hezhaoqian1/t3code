export type PresentationIntentOperation = "create" | "revise";

export type PresentationIntent = {
  readonly operation: PresentationIntentOperation;
};

const PRESENTATION_PATTERN = /(?:pptx?|幻灯片|演示文稿|演示材料|汇报材料|presentation|slide deck)/i;
const REVISION_PATTERN =
  /(?:修改|调整|优化|改成|改为|重做|更新|替换|拆成|删掉|增加|第\s*\d+\s*[页頁]|重新导出|重新生成)/i;

/** Detects explicit presentation language; ordinary chat stays untouched. */
export function detectPresentationIntent(text: string): PresentationIntent | null {
  const normalized = text.trim();
  if (!normalized || !PRESENTATION_PATTERN.test(normalized)) return null;
  return { operation: REVISION_PATTERN.test(normalized) ? "revise" : "create" };
}
