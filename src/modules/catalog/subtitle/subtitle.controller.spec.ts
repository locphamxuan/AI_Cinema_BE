import { NotFoundException } from '@nestjs/common';
import { readSubtitleFile } from './subtitle.controller';

describe('readSubtitleFile', () => {
  it('returns the WebVTT text', async () => {
    const fetcher = jest.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('WEBVTT') });
    await expect(readSubtitleFile('https://cdn/x.vtt', fetcher as unknown as typeof fetch)).resolves.toBe('WEBVTT');
    expect(fetcher).toHaveBeenCalledWith('https://cdn/x.vtt', expect.objectContaining({ signal: expect.anything() }));
  });

  it('answers 404 SUBTITLE_FILE_UNAVAILABLE when the storage misses the file', async () => {
    const fetcher = jest.fn().mockResolvedValue({ ok: false });
    await expect(readSubtitleFile('https://cdn/x.vtt', fetcher as unknown as typeof fetch)).rejects.toMatchObject({
      response: { details: { reason: 'SUBTITLE_FILE_UNAVAILABLE' } },
    });
  });

  it('answers 404 instead of 500 when the storage cannot be reached or times out', async () => {
    const fetcher = jest.fn().mockRejectedValue(new TypeError('fetch failed'));
    await expect(readSubtitleFile('https://cdn/x.vtt', fetcher as unknown as typeof fetch)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
