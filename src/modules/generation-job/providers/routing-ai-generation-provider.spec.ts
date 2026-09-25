import { ConfigService } from '@nestjs/config';
import { AI_MODEL_CATALOG } from 'src/modules/ai-model/ai-model-catalog';
import { RoutingAiGenerationProvider } from './routing-ai-generation-provider';
import type { MediaStorage } from './media-storage';

const configOf = (values: Record<string, string>) =>
  ({ get: (name: string) => values[name] }) as unknown as ConfigService;
const upload = jest.fn();
const storage = (configured: boolean) => ({ isConfigured: configured, upload }) as unknown as MediaStorage;

const jsonResponse = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const bytesResponse = (size: number) => new Response(new Uint8Array(size), { status: 200 });

describe('RoutingAiGenerationProvider', () => {
  const fetchMock = jest.fn<Promise<Response>, [string, RequestInit?]>();
  const urlOf = (call: number) => fetchMock.mock.calls[call][0];
  beforeEach(() => {
    fetchMock.mockReset();
    upload.mockReset().mockResolvedValue('https://cdn.test/generated/a.bin');
    global.fetch = fetchMock;
  });

  const LIVE = {
    AI_PROVIDER_MODE: 'live',
    OPENAI_API_KEY: 'sk',
    FAL_KEY: 'fal',
    ELEVENLABS_API_KEY: 'xi',
    GEMINI_API_KEY: 'g',
  };

  it('never calls a paid API outside live mode, even with keys set', async () => {
    const provider = new RoutingAiGenerationProvider(configOf({ ...LIVE, AI_PROVIDER_MODE: 'mock' }), storage(true));

    const result = await provider.generate({ model: AI_MODEL_CATALOG.llm, composedPrompt: 'Opening scene' });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.contentText).toContain('[mock gpt-4o-mini]');
  });

  it('keeps providers without a key on the mock', async () => {
    const provider = new RoutingAiGenerationProvider(
      configOf({ AI_PROVIDER_MODE: 'live', FAL_KEY: 'fal' }),
      storage(true),
    );

    await provider.generate({ model: AI_MODEL_CATALOG.llm, composedPrompt: 'Opening scene' });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('writes text with OpenAI and bills it by completion length', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ choices: [{ message: { content: 'Xin chào Sài Gòn' } }], usage: { completion_tokens: 250 } }),
    );
    const provider = new RoutingAiGenerationProvider(configOf(LIVE), storage(true));

    const result = await provider.generate({ model: AI_MODEL_CATALOG.llm, composedPrompt: 'Greet', language: 'vi' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(JSON.parse(init!.body as string)).toMatchObject({ model: 'gpt-4o-mini' });
    expect(result).toEqual({ outputUnits: 3, contentText: 'Xin chào Sài Gòn', mimeType: 'text/plain' });
  });

  it('draws with the Genre Style LoRA on fal.ai when the job carries one', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ images: [{ url: 'https://fal.media/x.jpg', content_type: 'image/jpeg' }] }),
    );
    const provider = new RoutingAiGenerationProvider(configOf(LIVE), storage(true));

    const result = await provider.generate({
      model: AI_MODEL_CATALOG.image,
      composedPrompt: 'Neon alley',
      seed: 7,
      loraWeights: 'https://weights.test/horror.safetensors',
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://fal.run/fal-ai/flux-lora');
    expect(JSON.parse(init!.body as string)).toMatchObject({
      seed: 7,
      loras: [{ path: 'https://weights.test/horror.safetensors', scale: 1 }],
    });
    expect(result.storageKey).toBe('https://fal.media/x.jpg');
  });

  it('stores ElevenLabs speech and measures its length from the mp3 size', async () => {
    fetchMock.mockResolvedValue(bytesResponse(16_000 * 12));
    const provider = new RoutingAiGenerationProvider(configOf(LIVE), storage(true));

    const result = await provider.generate({ model: AI_MODEL_CATALOG.tts, composedPrompt: 'Chào mừng' });

    expect(urlOf(0)).toContain('/text-to-speech/');
    expect(upload).toHaveBeenCalledWith(expect.any(Uint8Array), 'audio/mpeg', 'mp3');
    expect(result).toMatchObject({
      outputUnits: 12,
      durationSeconds: 12,
      storageKey: 'https://cdn.test/generated/a.bin',
    });
  });

  it('keeps audio and video on the mock while media storage is missing', async () => {
    const provider = new RoutingAiGenerationProvider(configOf(LIVE), storage(false));

    await provider.generate({ model: AI_MODEL_CATALOG.video, composedPrompt: 'Chase' });
    await provider.generate({ model: AI_MODEL_CATALOG.tts, composedPrompt: 'Chào' });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('polls the Veo operation until the clip is ready, then stores it', async () => {
    jest.useFakeTimers();
    try {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ name: 'models/veo/operations/1' }))
        .mockResolvedValueOnce(jsonResponse({ name: 'models/veo/operations/1', done: false }))
        .mockResolvedValueOnce(
          jsonResponse({
            name: 'models/veo/operations/1',
            done: true,
            response: { generateVideoResponse: { generatedSamples: [{ video: { uri: 'https://files.test/v.mp4' } }] } },
          }),
        )
        .mockResolvedValueOnce(bytesResponse(1024));
      const provider = new RoutingAiGenerationProvider(configOf(LIVE), storage(true));

      const pending = provider.generate({ model: AI_MODEL_CATALOG.video, composedPrompt: 'Chase' });
      await jest.advanceTimersByTimeAsync(20_000);
      const result = await pending;

      expect(urlOf(0)).toContain('veo-3.0-fast-generate-001:predictLongRunning');
      expect(urlOf(3)).toBe('https://files.test/v.mp4');
      expect(upload).toHaveBeenCalledWith(expect.any(Uint8Array), 'video/mp4', 'mp4');
      expect(result).toMatchObject({ outputUnits: 8, mimeType: 'video/mp4' });
    } finally {
      jest.useRealTimers();
    }
  });

  it('fails the job with the provider message on an API error', async () => {
    fetchMock.mockResolvedValue(new Response('{"error":"invalid_api_key"}', { status: 401 }));
    const provider = new RoutingAiGenerationProvider(configOf(LIVE), storage(true));

    await expect(provider.generate({ model: AI_MODEL_CATALOG.llm, composedPrompt: 'x' })).rejects.toThrow(
      'OpenAI responded 401: {"error":"invalid_api_key"}',
    );
  });
});
