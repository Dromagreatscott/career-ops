const SAFE_ERROR_BY_STATUS: Record<number, string> = {
  400: "Bad request.",
  404: "Not found.",
  409: "The record changed. Reload and try again.",
  422: "The saved data is invalid and needs operator review.",
  500: "Something went wrong. Check the server logs and try again.",
};

export function safeError(status: number, fallback?: string): { error: string } {
  return { error: fallback || SAFE_ERROR_BY_STATUS[status] || "Request failed." };
}

export function logInternalError(scope: string, error: unknown, context: Record<string, unknown> = {}): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ ts: new Date().toISOString(), scope, message, ...context }));
}
