export type SettingsPath =
  | "/settings/general"
  | "/settings/appearance"
  | "/settings/keybindings"
  | "/settings/projects"
  | "/settings/connectors"
  | "/settings/source-control"
  | "/settings/archived";

export interface SettingsSearchItem {
  readonly id: string;
  readonly title: string;
  readonly to: SettingsPath;
  readonly targetId?: string;
}

/**
 * Section labels in sidebar order. The sidebar nav and the search-result
 * subtitles both render from this record, so each label exists once.
 */
export const SETTINGS_SECTION_LABELS: Readonly<Record<SettingsPath, string>> = {
  "/settings/general": "通用",
  "/settings/appearance": "外观",
  "/settings/keybindings": "快捷键",
  "/settings/projects": "空间",
  "/settings/connectors": "连接器",
  "/settings/source-control": "版本控制",
  "/settings/archived": "归档",
};

/**
 * Every searchable setting, in result order. This catalog is the single
 * source of truth for anchor ids and visible titles: panels render both via
 * `searchableSetting`, so a retitle (or, later, a translation pass) happens
 * here once instead of separately in the panel and the index.
 */
export const SETTINGS_SEARCH_ITEMS = [
  {
    id: "color-scheme",
    title: "配色方案",
    to: "/settings/appearance",
    // The scheme tiles sit at the top of the Appearance section.
    targetId: "appearance",
  },
  {
    id: "theme",
    title: "主题",
    to: "/settings/appearance",
    // Theme cards live directly under the scheme tiles; the section is the
    // stable scroll destination for both.
    targetId: "appearance",
  },
  {
    // Prefixed because the slider control already owns the `glass-opacity` id.
    id: "setting-glass-opacity",
    title: "玻璃透明度",
    to: "/settings/appearance",
  },
  {
    id: "interface-font",
    title: "界面字体",
    to: "/settings/appearance",
  },
  {
    id: "prompt-font",
    title: "输入框字体",
    to: "/settings/appearance",
  },
  {
    id: "code-font",
    title: "代码字体",
    to: "/settings/appearance",
  },
  {
    id: "terminal-font",
    title: "终端字体",
    to: "/settings/appearance",
  },
  {
    id: "font-smoothing",
    title: "字体平滑",
    to: "/settings/appearance",
  },
  {
    id: "word-wrap",
    title: "自动换行",
    to: "/settings/appearance",
  },
  {
    id: "project-grouping",
    title: "空间分组",
    to: "/settings/general",
  },
  {
    id: "auto-settle-inactive-threads",
    title: "自动归纳不活跃任务",
    to: "/settings/general",
  },
  {
    id: "time-format",
    title: "时间格式",
    to: "/settings/general",
  },
  {
    id: "hide-whitespace-changes",
    title: "隐藏空白字符变更",
    to: "/settings/general",
  },
  {
    id: "new-threads",
    title: "新任务",
    to: "/settings/general",
  },
  {
    id: "start-from-origin",
    title: "从远端分支开始",
    to: "/settings/general",
    targetId: "new-threads",
  },
  {
    id: "add-project-starts-in",
    title: "添加空间的默认目录",
    to: "/settings/general",
  },
  {
    id: "archive-confirmation",
    title: "归档确认",
    to: "/settings/general",
  },
  {
    id: "delete-confirmation",
    title: "删除确认",
    to: "/settings/general",
  },
  {
    id: "diagnostics",
    title: "诊断",
    to: "/settings/general",
  },
  {
    id: "legacy-plan-mode",
    title: "规划模式（兼容）",
    to: "/settings/general",
  },
  {
    id: "legacy-token-streaming",
    title: "逐 Token 输出（兼容）",
    to: "/settings/general",
  },
  {
    id: "keybindings",
    title: "快捷键",
    to: "/settings/keybindings",
  },
  {
    id: "projects",
    title: "空间",
    to: "/settings/projects",
  },
  {
    id: "connectors",
    title: "连接器",
    to: "/settings/connectors",
  },
  {
    id: "feishu-connector",
    title: "飞书连接器",
    to: "/settings/connectors",
  },
  {
    id: "project-new-thread-workspace",
    title: "空间的新任务工作区",
    to: "/settings/projects",
  },
  {
    id: "project-scripts",
    title: "空间脚本",
    to: "/settings/projects",
  },
  {
    id: "project-checkouts",
    title: "空间检出目录",
    to: "/settings/projects",
  },
  {
    id: "source-control",
    title: "版本控制",
    to: "/settings/source-control",
  },
  {
    id: "archive",
    title: "已归档任务",
    to: "/settings/archived",
  },
] as const satisfies ReadonlyArray<SettingsSearchItem>;

export type SettingsSearchItemId = (typeof SETTINGS_SEARCH_ITEMS)[number]["id"];

const LEGACY_SETTINGS_SEARCH_TITLES: Readonly<Record<SettingsSearchItemId, string>> = {
  "color-scheme": "Color scheme",
  theme: "Themes",
  "setting-glass-opacity": "Glass opacity",
  "interface-font": "Interface font",
  "prompt-font": "Prompt font",
  "code-font": "Code font",
  "terminal-font": "Terminal font",
  "font-smoothing": "Font smoothing",
  "word-wrap": "Word wrap",
  "project-grouping": "Project grouping",
  "auto-settle-inactive-threads": "Auto-settle inactive threads",
  "time-format": "Time format",
  "hide-whitespace-changes": "Hide whitespace changes",
  "new-threads": "New threads",
  "start-from-origin": "Start from origin",
  "add-project-starts-in": "Add project starts in",
  "archive-confirmation": "Archive confirmation",
  "delete-confirmation": "Delete confirmation",
  diagnostics: "Diagnostics",
  "legacy-plan-mode": "Plan mode (legacy)",
  "legacy-token-streaming": "Stream token by token (legacy)",
  keybindings: "Keybindings",
  projects: "Projects",
  connectors: "Connectors",
  "feishu-connector": "Feishu connector",
  "project-new-thread-workspace": "Project new-thread workspace",
  "project-scripts": "Project scripts",
  "project-checkouts": "Project checkouts",
  "source-control": "Source control",
  archive: "Archived threads",
};

const SEARCH_ITEMS_BY_ID = Object.fromEntries(
  SETTINGS_SEARCH_ITEMS.map((item) => [item.id, item]),
) as Readonly<Record<SettingsSearchItemId, SettingsSearchItem>>;

/**
 * `id` and `title` props for the element a search item anchors to. Panels
 * spread (or pick from) this instead of restating the strings, so the catalog
 * and the rendered settings cannot drift apart.
 */
export function searchableSetting(id: SettingsSearchItemId): {
  readonly id: string;
  readonly title: string;
} {
  const { id: anchorId, title } = SEARCH_ITEMS_BY_ID[id];
  return { id: anchorId, title };
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function searchSettings(
  query: string,
  items: ReadonlyArray<SettingsSearchItem> = SETTINGS_SEARCH_ITEMS,
): ReadonlyArray<SettingsSearchItem> {
  const normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery.length === 0) return [];

  return items.filter((item) => {
    if (normalizeSearchText(item.title).includes(normalizedQuery)) return true;
    const legacyTitle = LEGACY_SETTINGS_SEARCH_TITLES[item.id as SettingsSearchItemId];
    return legacyTitle !== undefined && normalizeSearchText(legacyTitle).includes(normalizedQuery);
  });
}
