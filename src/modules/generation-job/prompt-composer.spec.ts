import { GenerationJobType } from '@prisma/client';
import { GeminiPromptComposer, spokenLine, TemplatePromptComposer } from './prompt-composer';
import type { GeminiTextClient } from './providers/gemini-text';

describe('Prompt Composer', () => {
  const scene = { sceneTitle: 'Phân cảnh 1', sceneDescription: 'buổi chiều ở làng quê', genre: 'Drama' };

  describe('TemplatePromptComposer', () => {
    const template = new TemplatePromptComposer();

    it("puts the Creator's request first for a visual job, without labels", async () => {
      const { composedPrompt } = await template.compose({
        jobType: GenerationJobType.SCENE_VIDEO,
        rawPrompt: 'con chó ta chạy trên đường làng',
        loraTriggerKeyword: 'aicstyle',
        ...scene,
      });

      expect(composedPrompt.startsWith('aicstyle, con chó ta chạy trên đường làng')).toBe(true);
      expect(composedPrompt).not.toMatch(/Scene:|Context:|Direction:/);
    });

    it('sends only the spoken line to the voice model', async () => {
      const { composedPrompt } = await template.compose({
        jobType: GenerationJobType.VOICE,
        rawPrompt: 'Minh Anh: "Hệ thống đang tự viết lại nhận thức."',
        scriptText: 'toàn bộ kịch bản',
      });

      expect(composedPrompt).toBe('Hệ thống đang tự viết lại nhận thức.');
    });
  });

  it.each([
    ['Minh Anh: "Xin chào"', 'Xin chào'],
    ['Minh Anh: Xin chào', 'Xin chào'],
    ['Xin chào mọi người', 'Xin chào mọi người'],
  ])('reads the spoken line of %s', (raw, line) => {
    expect(spokenLine(raw)).toBe(line);
  });

  describe('GeminiPromptComposer', () => {
    type Request = { system: string; prompt: string };
    const client = (answer: () => Promise<string>) => {
      const generate = jest.fn<Promise<string>, [Request]>(answer);
      const gemini = { isAvailable: true, model: 'gemini-2.5-flash-lite', generate } as unknown as GeminiTextClient;
      return { gemini, generate };
    };

    it('asks Gemini for an English visual prompt that keeps the request and the film context', async () => {
      const { gemini, generate } = client(() =>
        Promise.resolve('"A Vietnamese village dog runs down a dirt road at golden hour"'),
      );
      const composer = new GeminiPromptComposer(gemini);

      const composed = await composer.compose({
        jobType: GenerationJobType.SCENE_VIDEO,
        rawPrompt: 'con chó ta chạy trên đường làng',
        projectTitle: 'Làng tôi',
        previousScenePrompt: 'warm film look',
        ...scene,
      });

      expect(composed).toMatchObject({
        composedPrompt: 'A Vietnamese village dog runs down a dirt road at golden hour',
        composeModel: 'gemini-2.5-flash-lite',
      });
      const [{ system, prompt }] = generate.mock.calls[0];
      expect(system).toContain('text-to-video');
      expect(prompt.split('\n')[0]).toBe("Creator's request: con chó ta chạy trên đường làng");
      expect(prompt).toContain('Previous scene prompt: warm film look');
    });

    it('falls back to the template when Gemini fails', async () => {
      const composer = new GeminiPromptComposer(client(() => Promise.reject(new Error('429'))).gemini);

      const composed = await composer.compose({ jobType: GenerationJobType.SCENE_IMAGE, rawPrompt: 'con mèo' });

      expect(composed.composeModel).toBe('template-prompt-composer');
      expect(composed.composedPrompt.startsWith('con mèo')).toBe(true);
    });

    it('leaves text jobs to the template without calling Gemini', async () => {
      const { gemini, generate } = client(() => Promise.resolve('unused'));

      await new GeminiPromptComposer(gemini).compose({
        jobType: GenerationJobType.SCRIPT,
        rawPrompt: 'viết cảnh mở đầu',
      });

      expect(generate).not.toHaveBeenCalled();
    });
  });
});
