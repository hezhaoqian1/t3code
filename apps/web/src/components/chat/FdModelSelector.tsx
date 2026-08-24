import type { ServerProviderModel } from "@t3tools/contracts";
import {
  FD_RUNTIME_DEFAULT_MODEL,
  FD_RUNTIME_PRO_MODEL,
  isFdRuntimeSelectableModel,
  type FdRuntimeSelectableModel,
} from "@t3tools/contracts/fd/runtime-credentials";

import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

const MODEL_LABELS: Readonly<Record<FdRuntimeSelectableModel, string>> = {
  [FD_RUNTIME_DEFAULT_MODEL]: "V4 Flash",
  [FD_RUNTIME_PRO_MODEL]: "V4 Pro",
};

export function fdModelLabel(model: FdRuntimeSelectableModel): string {
  return MODEL_LABELS[model];
}

export function resolveFdModelOptions(
  models: ReadonlyArray<ServerProviderModel>,
): ReadonlyArray<FdRuntimeSelectableModel> {
  return models.flatMap((model) => (isFdRuntimeSelectableModel(model.slug) ? [model.slug] : []));
}

export function resolveFdModelChange(
  nextValue: string | null,
  options: ReadonlyArray<FdRuntimeSelectableModel>,
): FdRuntimeSelectableModel | null {
  return nextValue && isFdRuntimeSelectableModel(nextValue) && options.includes(nextValue)
    ? nextValue
    : null;
}

export function FdModelSelector(props: {
  value: string;
  models: ReadonlyArray<ServerProviderModel>;
  disabled?: boolean;
  onValueChange: (model: FdRuntimeSelectableModel) => void;
}) {
  const options = resolveFdModelOptions(props.models);
  if (options.length === 0) return null;
  const value =
    isFdRuntimeSelectableModel(props.value) && options.includes(props.value)
      ? props.value
      : (options[0] ?? FD_RUNTIME_DEFAULT_MODEL);

  return (
    <Select
      value={value}
      disabled={props.disabled || options.length < 2}
      onValueChange={(nextValue) => {
        const selected = resolveFdModelChange(nextValue, options);
        if (selected) props.onValueChange(selected);
      }}
    >
      <SelectTrigger
        size="sm"
        aria-label="选择模型"
        data-fd-model-selector="true"
        className="h-8 w-24 min-w-24 shrink-0 border-border/70 bg-background/60 px-2 text-xs font-medium shadow-none"
      >
        <SelectValue>{fdModelLabel(value)}</SelectValue>
      </SelectTrigger>
      <SelectPopup side="top" align="end" alignItemWithTrigger={false} matchTriggerWidth={false}>
        {options.map((model) => (
          <SelectItem key={model} value={model} className="min-w-32" hideIndicator>
            {fdModelLabel(model)}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}
