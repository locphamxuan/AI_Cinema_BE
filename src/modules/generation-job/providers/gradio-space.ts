/**
 * The one call made to a Gradio Space. @gradio/client's published types do not resolve under
 * this project's module settings, so the part used is typed here; tests replace this module.
 */
interface GradioApp {
  predict(endpoint: string, payload: Record<string, unknown>): Promise<{ data: unknown }>;
}
interface GradioModule {
  Client: { connect(space: string, options: { token: string }): Promise<GradioApp> };
}

export async function callSpace(space: string, token: string, endpoint: string, payload: Record<string, unknown>) {
  const { Client } = (await import('@gradio/client')) as unknown as GradioModule;
  const app = await Client.connect(space, { token });
  const result = await app.predict(endpoint, payload);
  return result.data;
}
