/** fetch() that fails with the provider's own error text instead of a bare status code. */
export async function callProvider(
  provider: string,
  url: string,
  init: RequestInit,
  timeoutMs = 120_000,
): Promise<Response> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 500);
    throw new Error(`${provider} responded ${response.status}: ${body}`);
  }
  return response;
}

export async function callProviderJson<T>(
  provider: string,
  url: string,
  init: RequestInit,
  timeoutMs?: number,
): Promise<T> {
  const response = await callProvider(provider, url, init, timeoutMs);
  return (await response.json()) as T;
}

/**
 * The free tier of a provider is used up for now. The job fails without being charged;
 * the Creator can generate again once the free quota resets.
 */
export class QuotaExceededError extends Error {
  constructor(provider: string, detail: string) {
    super(`${provider} free quota is used up for now, try again later (nothing was charged): ${detail.slice(0, 200)}`);
  }
}
