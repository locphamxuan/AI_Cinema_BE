/**
 * Raised when no AI answer can be produced; the chat service turns it into an escalation.
 * It lives beside the provider clients so a transport failure and a missing configuration
 * reach the support layer as the same type.
 */
export class SupportAiUnavailableError extends Error {
  constructor(
    readonly cause: 'DISABLED' | 'NOT_CONFIGURED' | 'PROVIDER_ERROR',
    message: string,
  ) {
    super(message);
    this.name = 'SupportAiUnavailableError';
  }
}
