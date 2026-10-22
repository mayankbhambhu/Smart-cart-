/** A cart operation the caller can fix; the route maps it to an HTTP status. */
export class CartError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409,
    readonly code: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(code);
  }
}
