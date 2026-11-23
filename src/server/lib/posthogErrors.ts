// Fork addition (FORK-CHANGES.md): PostHog API errors, a leaf module so
// tests can import them without the client.

export class PosthogNotConfiguredError extends Error {
  constructor() {
    super("No PostHog API key is connected for this project.");
    this.name = "PosthogNotConfiguredError";
  }
}

export class PosthogApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly retryAfterSeconds: number | null = null,
    /** PostHog's error code, e.g. "authentication_failed" (bad key or
     *  wrong region) or "permission_denied" (scope or project). */
    public readonly code: string | null = null,
  ) {
    super(message);
    this.name = "PosthogApiError";
  }
}
