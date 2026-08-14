interface DraftHeroHeadlineProps {
  readonly officeMode?: boolean;
}

export function DraftHeroHeadline({ officeMode = false }: DraftHeroHeadlineProps) {
  if (officeMode) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-4 text-center">
        <h1 className="font-normal text-2xl text-foreground sm:text-3xl">今天想处理什么？</h1>
      </div>
    );
  }

  return (
    <h1 className="mx-auto w-full max-w-5xl text-center font-normal text-2xl text-foreground tracking-tight sm:text-3xl">
      今天想处理什么？
    </h1>
  );
}
