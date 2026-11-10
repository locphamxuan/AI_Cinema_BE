import { hlsArguments, ladderFor, parseFfprobe } from './media-processor';

const valueAfter = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

describe('FFmpeg HLS ladder (LI-02)', () => {
  it('never upscales, but keeps at least 360p', () => {
    expect(ladderFor(2160).map((r) => r.name)).toEqual(['1080p', '720p', '360p']);
    expect(ladderFor(720).map((r) => r.name)).toEqual(['720p', '360p']);
    expect(ladderFor(240).map((r) => r.name)).toEqual(['360p']);
  });

  it('encodes one rendition per rung with audio when the source has some', () => {
    const args = hlsArguments('/tmp/in.mp4', { durationSeconds: 600, height: 1080, hasAudio: true });

    expect(valueAfter(args, '-filter_complex')).toContain('split=3[s0][s1][s2]');
    expect(args.filter((arg) => arg === '0:a:0')).toHaveLength(3);
    expect(valueAfter(args, '-var_stream_map')).toBe('v:0,a:0,name:1080p v:1,a:1,name:720p v:2,a:2,name:360p');
    expect(valueAfter(args, '-hls_playlist_type')).toBe('vod');
    expect(args.at(-1)).toBe('%v/index.m3u8');
  });

  it('maps no audio for a silent source', () => {
    const args = hlsArguments('/tmp/in.mov', { durationSeconds: 60, height: 720, hasAudio: false });

    expect(args).not.toContain('0:a:0');
    expect(args).not.toContain('aac');
    expect(valueAfter(args, '-var_stream_map')).toBe('v:0,name:720p v:1,name:360p');
  });
});

describe('ffprobe output', () => {
  it('reads the duration, the picture height and whether there is sound', () => {
    const json = JSON.stringify({
      format: { duration: '612.48' },
      streams: [{ codec_type: 'video', height: 1080 }, { codec_type: 'audio' }],
    });
    expect(parseFfprobe(json)).toEqual({ durationSeconds: 612, height: 1080, hasAudio: true });
  });

  it('refuses a file without a video stream', () => {
    const json = JSON.stringify({ format: { duration: '10' }, streams: [{ codec_type: 'audio' }] });
    expect(() => parseFfprobe(json)).toThrow('no video stream');
  });
});
