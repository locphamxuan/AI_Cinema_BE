import { ConfigService } from '@nestjs/config';
import { AI_MODEL_CATALOG } from 'src/modules/ai-model/ai-model-catalog';
import { RoutingAiGenerationProvider } from './routing-ai-generation-provider';
import type { MediaStorage } from './media-storage';

const predict = jest.fn();
jest.mock('./gradio-space', () => ({
  callSpace: (_space: string, _token: string, endpoint: string, payload: object) =>
    (predict(endpoint, payload) as Promise<{ data: unknown }>).then((r) => r.data),
}));

const configOf = (values: Record<string, string>) =>
  ({ get: (name: string) => values[name] }) as unknown as ConfigService;
const upload = jest.fn();
const storage = (configured: boolean) => ({ isConfigured: configured, upload }) as unknown as MediaStorage;

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const bytesResponse = (size: number, type: string) =>
  new Response(new Uint8Array(size), { status: 200, headers: { 'content-type': type } });

const LIVE = { AI_PROVIDER_MODE: 'live', GEMINI_API_KEY: 'g-key', HF_TOKEN: 'hf_token' };

describe('RoutingAiGenerationProvider (free tiers only)', () => {
  const fetchMock = jest.fn<Promise<Response>, [string, RequestInit?]>();
  const urlOf = (call: number) => fetchMock.mock.calls[call][0];
  beforeEach(() => {
    fetchMock.mockReset();
    predict.mockReset();
    upload.mockReset().mockResolvedValue('https://pub.r2.dev/generated/a.bin');
    global.fetch = fetchMock;
  });

  it('never calls a real service outside live mode, even with keys set', async () => {
    const provider = new RoutingAiGenerationProvider(configOf({ ...LIVE, AI_PROVIDER_MODE: 'mock' }), storage(true));
    const result = await provider.generate({ model: AI_MODEL_CATALOG.llm, composedPrompt: 'Opening scene' });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.contentText).toContain('[mock gemini-2.5-flash-lite]');
  });

  it('writes a subtitle with Gemini and bills it by output length', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        candidates: [{ content: { parts: [{ text: 'Xin chào Sài Gòn' }] } }],
        usageMetadata: { candidatesTokenCount: 250 },
      }),
    );
    const provider = new RoutingAiGenerationProvider(configOf(LIVE), storage(false));

    const result = await provider.generate({ model: AI_MODEL_CATALOG.llm, composedPrompt: 'Greet', language: 'vi' });

    expect(urlOf(0)).toContain('gemini-2.5-flash-lite:generateContent');
    expect(result).toEqual({ outputUnits: 3, contentText: 'Xin chào Sài Gòn', mimeType: 'text/plain' });
  });

  it('turns Gemini speech into a playable WAV and measures it', async () => {
    const pcm = Buffer.alloc(48_000 * 3).toString('base64');
    fetchMock.mockResolvedValue(
      jsonResponse({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16', data: pcm } }] } }] }),
    );
    const provider = new RoutingAiGenerationProvider(configOf(LIVE), storage(true));

    const result = await provider.generate({ model: AI_MODEL_CATALOG.tts, composedPrompt: 'Chào mừng' });

    const [wav, mimeType] = upload.mock.calls[0] as [Buffer, string];
    expect(wav.subarray(0, 4).toString()).toBe('RIFF');
    expect(mimeType).toBe('audio/wav');
    expect(result).toMatchObject({ outputUnits: 3, durationSeconds: 3 });
  });

  it('draws an image on Hugging Face and keeps it in media storage', async () => {
    fetchMock.mockResolvedValue(bytesResponse(1000, 'image/jpeg'));
    const provider = new RoutingAiGenerationProvider(configOf(LIVE), storage(true));

    const result = await provider.generate({ model: AI_MODEL_CATALOG.image, composedPrompt: 'Neon alley', seed: 7 });

    expect(urlOf(0)).toContain('stable-diffusion-3-medium');
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toMatchObject({ parameters: { seed: 7 } });
    expect(upload).toHaveBeenCalledWith(expect.any(Uint8Array), 'image/jpeg', 'jpg');
    expect(result.storageKey).toBe('https://pub.r2.dev/generated/a.bin');
  });

  it('renders a clip on the LTX-Video Space and copies it to storage', async () => {
    predict.mockResolvedValue({ data: [{ video: { url: 'https://space.hf.space/file=/tmp/clip.mp4' } }, 1] });
    fetchMock.mockResolvedValue(bytesResponse(2048, 'video/mp4'));
    const provider = new RoutingAiGenerationProvider(configOf({ ...LIVE, HF_VIDEO_SECONDS: '5' }), storage(true));

    const result = await provider.generate({ model: AI_MODEL_CATALOG.video, composedPrompt: 'Chase' });

    expect(predict).toHaveBeenCalledWith(
      '/text_to_video',
      expect.objectContaining({ mode: 'text-to-video', duration_ui: 5 }),
    );
    expect(upload).toHaveBeenCalledWith(expect.any(Uint8Array), 'video/mp4', 'mp4');
    expect(result).toMatchObject({ outputUnits: 5, mimeType: 'video/mp4' });
  });

  it('falls back to the sample library when a free quota is used up, instead of failing the job', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { message: 'quota' } }, 429));
    predict.mockRejectedValue(new Error('You have exceeded your GPU quota'));
    const provider = new RoutingAiGenerationProvider(configOf(LIVE), storage(true));

    const text = await provider.generate({ model: AI_MODEL_CATALOG.llm, composedPrompt: 'x' });
    const clip = await provider.generate({ model: AI_MODEL_CATALOG.video, composedPrompt: 'y' });

    expect(text.contentText).toContain('[mock');
    expect(clip.mimeType).toBe('application/vnd.apple.mpegurl');
  });

  it('still fails the job on a real error such as a revoked key', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { message: 'API key not valid' } }, 400));
    const provider = new RoutingAiGenerationProvider(configOf(LIVE), storage(false));

    await expect(provider.generate({ model: AI_MODEL_CATALOG.llm, composedPrompt: 'x' })).rejects.toThrow(
      'Gemini responded 400',
    );
  });

  it('keeps voice, images and video on the mock without media storage, and music always', async () => {
    const provider = new RoutingAiGenerationProvider(configOf(LIVE), storage(false));

    for (const model of [
      AI_MODEL_CATALOG.tts,
      AI_MODEL_CATALOG.image,
      AI_MODEL_CATALOG.video,
      AI_MODEL_CATALOG.music,
    ]) {
      await provider.generate({ model, composedPrompt: 'x' });
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(predict).not.toHaveBeenCalled();
  });
});
