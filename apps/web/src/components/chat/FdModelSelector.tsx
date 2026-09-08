import type { ServerProviderModel } from "@t3tools/contracts";

import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

export function fdModelLabel(model: ServerProviderModel | string): string {
  return typeof model === "string" ? model : (model.shortName ?? model.name);
}

export function resolveFdModelOptions(
  models: ReadonlyArray<ServerProviderModel>,
): ReadonlyArray<string> {
  return models.map((model) => model.slug);
}

export function resolveFdModelChange(
  nextValue: string | null,
  options: ReadonlyArray<string>,
): string | null {
  return nextValue && options.includes(nextValue) ? nextValue : null;
}

export function FdModelSelector(props: {
  value: string;
  models: ReadonlyArray<ServerProviderModel>;
  disabled?: boolean;
  onValueChange: (model: string) => void;
}) {
  const options = resolveFdModelOptions(props.models);
  if (options.length === 0) return null;
  const value = options.includes(props.value) ? props.value : (options[0] ?? "");

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
        <SelectValue>
          {fdModelLabel(props.models.find((model) => model.slug === value) ?? value)}
        </SelectValue>
      </SelectTrigger>
      <SelectPopup side="top" align="end" alignItemWithTrigger={false} matchTriggerWidth={false}>
        {options.map((model) => (
          <SelectItem key={model} value={model} className="min-w-32" hideIndicator>
            {fdModelLabel(props.models.find((candidate) => candidate.slug === model) ?? model)}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}
