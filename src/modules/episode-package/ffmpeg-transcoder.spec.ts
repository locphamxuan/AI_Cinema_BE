import type { MediaStorage } from 'src/modules/generation-job/providers/media-storage';
import { FfmpegVideoTranscoder, HLS_LADDER, hlsArguments } from './ffmpeg-transcoder';

describe('FFmpeg HLS transcoder (LI-02)', () => {
  it('joins every clip in order and encodes one rendition per ladder rung', () => {
    const args = hlsArguments(['https://cdn/a.mp4', 'https://cdn/b.mp4']);
    const filter = args[args.indexOf('-filter_complex') + 1];

    expect(args.filter((arg) => arg === '-i')).toHaveLength(2);
    expect(filter).toContain('[c0][c1]concat=n=2:v=1:a=0[cut]');
    expect(filter).toContain(`split=${HLS_LADDER.length}`);
    expect(args[args.indexOf('-var_stream_map') + 1]).toBe('v:0,name:1080p v:1,name:720p v:2,name:360p');
    expect(args.at(-1)).toBe('%v/index.m3u8');
  });

  it('refuses to run without media storage to upload the stream to', async () => {
    const transcoder = new FfmpegVideoTranscoder({ isConfigured: false } as MediaStorage);
    await expect(transcoder.transcode([{ storageKey: 'a.mp4', durationSeconds: 4 }])).rejects.toThrow('media storage');
  });
});
