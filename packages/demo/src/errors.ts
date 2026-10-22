/** An API error as the demo backends raise it: HTTP status plus the API's machine-readable code. */
export class DemoApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(code);
  }
}
