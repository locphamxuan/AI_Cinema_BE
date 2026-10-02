import { lookup as dnsLookup } from 'node:dns';
import { lookup } from 'node:dns/promises';
import { createWriteStream } from 'node:fs';
import * as http from 'node:http';
import type { IncomingMessage } from 'node:http';
import * as https from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import { pipeline } from 'node:stream/promises';

/** Addresses an import URL may never reach: loopback, private, link-local (cloud metadata), CGNAT, multicast… */
const BLOCKED = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  BLOCKED.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  BLOCKED.addSubnet(network, prefix, 'ipv6');
}

const MAX_REDIRECTS = 5;
const DEFAULT_TIMEOUT_MS = 30_000;

/** A URL the platform refuses to fetch, or a fetch that failed; the message is safe to show the Creator. */
export class UnsafeUrlError extends Error {}

export function isBlockedAddress(address: string): boolean {
  // An IPv4-mapped IPv6 address (::ffff:10.0.0.1) is checked as the IPv4 address it carries.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return BLOCKED.check(mapped[1], 'ipv4');
  const family = isIP(address);
  if (family === 0) return true;
  return BLOCKED.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

export interface UrlPolicy {
  /** Lets URLs reach localhost and private networks (local development only). */
  allowPrivate: boolean;
  timeoutMs?: number;
}

/** Only public http(s) URLs: every address the host resolves to must be public (SSRF, §11). */
export async function assertPublicUrl(raw: string, policy: UrlPolicy): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError('The link is not a valid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UnsafeUrlError('Only http and https links can be imported');
  }
  if (url.username || url.password) throw new UnsafeUrlError('The link must not carry a user name or password');
  if (policy.allowPrivate) return url;

  const host = url.hostname.replace(/^\[|\]$/g, '');
  let addresses: string[];
  try {
    addresses = isIP(host) ? [host] : (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);
  } catch {
    throw new UnsafeUrlError(`The host ${host} cannot be resolved`);
  }
  if (!addresses.length || addresses.some(isBlockedAddress)) {
    throw new UnsafeUrlError('The link points to a private or local network address');
  }
  return url;
}

/**
 * DNS lookup used at connect time: the address the socket really connects to is the one
 * checked, so a host cannot resolve to a public address for the check and to an internal one
 * for the request (DNS rebinding).
 */
function guardedLookup(allowPrivate: boolean): LookupFunction {
  return (hostname, options, callback) => {
    dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
      if (error) return callback(error, '', 0);
      const list = addresses;
      if (!allowPrivate && (!list.length || list.some((a) => isBlockedAddress(a.address)))) {
        return callback(new UnsafeUrlError('The link points to a private or local network address'), '', 0);
      }
      if (options.all) return callback(null, list);
      callback(null, list[0].address, list[0].family);
    });
  };
}

function send(url: URL, policy: UrlPolicy, timeoutMs: number): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const req = client.get(url, {
      lookup: guardedLookup(policy.allowPrivate),
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': 'AI-Cinema-Ingest/1.0' },
    });
    req.on('response', resolve);
    req.on('error', (error) =>
      reject(
        error instanceof UnsafeUrlError ? error : new UnsafeUrlError(`The link cannot be reached: ${error.message}`),
      ),
    );
  });
}

/**
 * GET that re-checks every redirect hop against the policy, so a public URL cannot bounce the
 * worker to an internal address. The caller reads (or destroys) the body.
 */
export async function safeGet(raw: string, policy: UrlPolicy): Promise<IncomingMessage> {
  const timeoutMs = policy.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let current = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const url = await assertPublicUrl(current, policy);
    const response = await send(url, policy, timeoutMs);
    const status = response.statusCode ?? 0;
    const location = response.headers.location;
    if (status >= 300 && status < 400 && location) {
      response.destroy();
      current = new URL(location, url).toString();
      continue;
    }
    if (status < 200 || status >= 300) {
      response.destroy();
      throw new UnsafeUrlError(`The link answered HTTP ${status}`);
    }
    return response;
  }
  throw new UnsafeUrlError(`The link redirects more than ${MAX_REDIRECTS} times`);
}

/** A small text resource (an HLS playlist), refused when it is larger than `maxBytes`. */
export async function fetchText(raw: string, policy: UrlPolicy, maxBytes = 2 * 1024 * 1024): Promise<string> {
  const response = await safeGet(raw, policy);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of response as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > maxBytes) {
      response.destroy();
      throw new UnsafeUrlError('The playlist is too large');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Streams a remote file to `target`, stopping as soon as it grows past `maxBytes`. Returns its size. */
export async function downloadTo(raw: string, target: string, policy: UrlPolicy, maxBytes: number): Promise<number> {
  const tooLarge = () => new UnsafeUrlError(`The file is larger than ${Math.floor(maxBytes / 1024 / 1024)} MB`);
  const response = await safeGet(raw, { ...policy, timeoutMs: policy.timeoutMs ?? 30 * 60_000 });
  if (Number(response.headers['content-length']) > maxBytes) {
    response.destroy();
    throw tooLarge();
  }

  let size = 0;
  response.on('data', (chunk: Buffer) => {
    size += chunk.length;
    if (size > maxBytes) response.destroy(tooLarge());
  });
  await pipeline(response, createWriteStream(target));
  if (size === 0) throw new UnsafeUrlError('The link returned an empty file');
  return size;
}
