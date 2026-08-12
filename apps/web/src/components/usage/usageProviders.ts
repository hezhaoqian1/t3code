import type { UsageProviderKind } from "@t3tools/contracts";

import { SparklesIcon } from "lucide-react";
import type { Icon } from "../Icons";

/**
 * Series and table order. The chart layers both providers from a shared zero
 * baseline, so this only fixes the reading order of legends, tables and hover
 * rows; it does not decide which series sits above the other.
 */
export const PROVIDER_ORDER: readonly UsageProviderKind[] = ["fd-deepseek"];

export const PROVIDER_LABEL: Record<UsageProviderKind, string> = {
  "fd-deepseek": "FD DeepSeek",
};

export const PROVIDER_COLOR: Record<UsageProviderKind, string> = {
  "fd-deepseek": "#16a34a",
};

export const PROVIDER_MARK: Record<UsageProviderKind, Icon> = {
  "fd-deepseek": SparklesIcon,
};
