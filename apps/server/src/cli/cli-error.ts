/**
 * The one-line reason for a failed CLI run. Drizzle wraps driver errors in
 * `DrizzleQueryError`, whose message is the query plus a `params:` line; the
 * real pg error is its `cause`.
 */
export function cliErrorMessage(err: unknown): string {
  const cause = err instanceof Error ? err.cause : undefined;
  const message = cause instanceof Error ? cause.message : err instanceof Error ? err.message : String(err);
  return message.replace(/\s*\n\s*/g, ' ').trim() || 'unknown error';
}

/**
 * nest-commander's `serviceErrorHandler`: without it a failing command prints
 * the error and exits 0. Writes the reason as the last stderr line (the
 * scheduler reports that line) and fails the process.
 */
export function cliServiceErrorHandler(err: unknown): void {
  process.stderr.write(`${cliErrorMessage(err)}\n`);
  process.exitCode = 1;
}
