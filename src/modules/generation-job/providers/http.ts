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

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The free tier of a provider is used up for now. The router falls back to the sample
 * library instead of failing the job, so production keeps working without paying.
 */
export class QuotaExceededError extends Error {
  constructor(provider: string, detail: string) {
    super(`${provider} free quota exceeded: ${detail.slice(0, 200)}`);
  }
}
