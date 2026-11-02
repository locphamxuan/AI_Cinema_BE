/** Raised when no AI answer can be produced; the chat service turns it into an escalation. */
export class SupportAiUnavailableError extends Error {
  constructor(
    readonly cause: 'DISABLED' | 'NOT_CONFIGURED' | 'PROVIDER_ERROR',
    message: string,
  ) {
    super(message);
    this.name = 'SupportAiUnavailableError';
  }
}
