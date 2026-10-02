const MAX_ERROR_CAUSE_DEPTH = 5;

/** The best one-line message for an unknown thrown value. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  return "发生了未知错误。";
}

/** The stack, or the closest thing to it, for one error in a cause chain. */
export function errorDetails(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error, null, 2) ?? String(error);
  } catch {
    return "没有更多错误详情。";
  }
}

/**
 * Full error text an employee can paste to IT: app build, page path, time,
 * client, then the stack and any cause chain. Takes the pathname only so
 * tokens in the query never land on the clipboard.
 */
export function errorReport(
  error: unknown,
  context: {
    appName: string;
    appVersion: string;
    pathname: string;
    userAgent?: string;
    now?: Date;
  },
): string {
  const lines = [
    `${context.appName} ${context.appVersion}`,
    `页面: ${context.pathname}`,
    `时间: ${(context.now ?? new Date()).toISOString()}`,
    ...(context.userAgent ? [`客户端: ${context.userAgent}`] : []),
    "",
    errorDetails(error),
  ];
  let cause = error instanceof Error ? error.cause : undefined;
  for (let depth = 0; cause !== undefined && depth < MAX_ERROR_CAUSE_DEPTH; depth += 1) {
    lines.push("", "原因:", errorDetails(cause));
    cause = cause instanceof Error ? cause.cause : undefined;
  }
  return lines.join("\n");
}
