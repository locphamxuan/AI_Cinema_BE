import { randomBytes, randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { hashPassword } from 'src/modules/identity/auth/credentials';
import { deriveChallenge } from 'src/modules/identity/oauth/pkce';
import { type Actor, bootApp, signIn } from './support/api';
import { newStudio, studioAccount } from './support/projects';

interface Tokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
  scope: string;
}

const REDIRECT = 'http://studio.example/api/auth/callback';
const SECRET = 'e2e-studio-web-secret';

/**
 * Studio Web signs a studio in through AI Cinema (Authorization Code + PKCE, 11/11/2026): the FE shows the consent
 * screen with the studio's platform session, Studio Web's server swaps the code for tokens that only open the
 * studio portal, refresh tokens rotate, a replay ends the client's sessions and a deactivated studio loses access.
 */
describe('Studio Web OAuth (e2e)', () => {
  let app: INestApplication<App>;
  let admin: Actor;
  let member: Actor;
  let studio: Actor;
  let studioId: string;
  const clientId = `e2e-studio-web-${randomUUID()}`;
  const verifier = randomBytes(32).toString('base64url');

  const authorizeQuery = (overrides: Record<string, string> = {}) => ({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT,
    scope: 'studio:portal',
    state: 'xyz',
    code_challenge: deriveChallenge(verifier),
    code_challenge_method: 'S256',
    ...overrides,
  });
  const qs = (query: Record<string, string>) => new URLSearchParams(query).toString();
  const form = (path: string, body: Record<string, string>, basic = true) => {
    const req = request(app.getHttpServer()).post(`/api/oauth/${path}`).type('form');
    if (basic) req.set('Authorization', `Basic ${Buffer.from(`${clientId}:${SECRET}`).toString('base64')}`);
    return req.send(body);
  };
  const bearer = (token: string, path: string) =>
    request(app.getHttpServer()).get(`/api${path}`).set('Authorization', `Bearer ${token}`);

  /** The studio approves on the consent screen; answers the code Studio Web receives on its callback. */
  const approve = async (): Promise<string> => {
    const { redirectTo } = await studio.post<{ redirectTo: string }>(
      '/oauth/authorize',
      { ...authorizeQuery(), approve: true },
      200,
    );
    const url = new URL(redirectTo);
    expect(url.searchParams.get('state')).toBe('xyz');
    return url.searchParams.get('code')!;
  };
  const exchange = (code: string) =>
    form('token', { grant_type: 'authorization_code', code, redirect_uri: REDIRECT, code_verifier: verifier });

  beforeAll(async () => {
    app = await bootApp();
    [admin, member] = await Promise.all([signIn(app, 'admin@aicinema.com'), signIn(app, 'member01@aicinema.com')]);
    await app.get(PrismaService).oAuthClient.create({
      data: {
        clientId,
        name: 'Studio Web e2e',
        redirectUris: [REDIRECT],
        scopes: ['studio:portal'],
        clientSecretHash: await hashPassword(SECRET),
      },
    });
    studioId = (await newStudio(admin, 'Studio OAuth e2e')).id;
    studio = await studioAccount(admin, studioId);
  });

  afterAll(() => app.close());

  it('shows the consent screen only to a studio account and checks the request first', async () => {
    const view = await studio.get<{ client: { clientId: string }; account: { role: string; studioName: string } }>(
      `/oauth/authorize?${qs(authorizeQuery())}`,
    );
    expect(view.client.clientId).toBe(clientId);
    expect(view.account).toMatchObject({ role: 'STUDIO', studioName: 'Studio OAuth e2e' });

    await member.get(`/oauth/authorize?${qs(authorizeQuery())}`, 403);
    await studio.get(`/oauth/authorize?${qs(authorizeQuery({ client_id: 'nobody' }))}`, 400);
    await studio.get(`/oauth/authorize?${qs(authorizeQuery({ redirect_uri: 'http://evil.example/cb' }))}`, 400);
    await studio.get(`/oauth/authorize?${qs(authorizeQuery({ response_type: 'token' }))}`, 400);
    await studio.get(`/oauth/authorize?${qs(authorizeQuery({ scope: 'admin:all' }))}`, 400);
    await studio.get(`/oauth/authorize?${qs(authorizeQuery({ code_challenge_method: 'plain' }))}`, 400);
    await studio.get(`/oauth/authorize?${qs(authorizeQuery({ state: ' ' }))}`, 400);
  });

  it('sends a refusal back to Studio Web as access_denied', async () => {
    const { redirectTo } = await studio.post<{ redirectTo: string }>(
      '/oauth/authorize',
      { ...authorizeQuery(), approve: false },
      200,
    );
    expect(new URL(redirectTo).searchParams.get('error')).toBe('access_denied');
  });

  it('swaps the code once for portal-only tokens, rotates refresh tokens and revokes on sign-out', async () => {
    const code = await approve();

    expect((await form('token', { grant_type: 'authorization_code', code }, true)).status).toBe(400);
    expect((await form('token', { grant_type: 'authorization_code', code }, false)).status).toBe(401);
    const wrongVerifier = await form('token', {
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT,
      code_verifier: randomBytes(32).toString('base64url'),
    });
    expect(wrongVerifier.body).toMatchObject({ error: 'invalid_grant' });

    const issued = await exchange(code);
    expect(issued.status).toBe(200);
    const tokens = issued.body as Tokens;
    expect(tokens).toMatchObject({ token_type: 'Bearer', scope: 'studio:portal' });

    expect((await bearer(tokens.access_token, '/studio-portal/me')).status).toBe(200);
    expect((await bearer(tokens.access_token, '/auth/me')).status).toBe(200);
    expect((await bearer(tokens.access_token, '/studios')).status).toBe(403);

    const rotated = await form('token', { grant_type: 'refresh_token', refresh_token: tokens.refresh_token });
    expect(rotated.status).toBe(200);
    const next = rotated.body as Tokens;
    expect(next.refresh_token).not.toBe(tokens.refresh_token);

    // Replaying the first refresh token means it leaked: the client's sessions for the account end.
    const replay = await form('token', { grant_type: 'refresh_token', refresh_token: tokens.refresh_token });
    expect(replay.body).toMatchObject({ error: 'invalid_grant' });
    const afterReplay = await form('token', { grant_type: 'refresh_token', refresh_token: next.refresh_token });
    expect(afterReplay.status).toBe(400);
    expect((await exchange(code)).body).toMatchObject({ error: 'invalid_grant' });

    const fresh = (await exchange(await approve())).body as Tokens;
    expect((await form('revoke', { token: fresh.refresh_token })).status).toBe(200);
    expect((await form('revoke', { token: 'unknown-token' })).status).toBe(200);
    const revoked = await form('token', { grant_type: 'refresh_token', refresh_token: fresh.refresh_token });
    expect(revoked.status).toBe(400);
    expect((await form('token', { grant_type: 'refresh_token' })).body).toMatchObject({ error: 'invalid_request' });
  });

  it('drops every token of a studio the Admin deactivates', async () => {
    const tokens = (await exchange(await approve())).body as Tokens;
    await admin.patch(`/studios/${studioId}`, { isActive: false });

    expect((await bearer(tokens.access_token, '/studio-portal/me')).status).toBe(401);
    const refreshed = await form('token', { grant_type: 'refresh_token', refresh_token: tokens.refresh_token });
    expect(refreshed.body).toMatchObject({ error: 'invalid_grant' });
  });
});
