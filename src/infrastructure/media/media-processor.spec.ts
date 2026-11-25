import { copiesTopRung, hlsArguments, ladderFor, parseFfprobe, subtitleArguments } from './media-processor';

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
    expect(parseFfprobe(json)).toMatchObject({ durationSeconds: 612, height: 1080, hasAudio: true, rotated: false });
  });

  it('refuses a file without a video stream', () => {
    const json = JSON.stringify({ format: { duration: '10' }, streams: [{ codec_type: 'audio' }] });
    expect(() => parseFfprobe(json)).toThrow('no video stream');
  });
});

describe('stream copy of the top rung', () => {
  const h264 = {
    durationSeconds: 600,
    height: 1080,
    hasAudio: true,
    videoCodec: 'h264',
    pixelFormat: 'yuv420p',
    audioCodec: 'aac',
    videoBitrate: 4_500_000,
  };

  it('copies an 8-bit H.264 source of the rung height and a sane bitrate', () => {
    expect(copiesTopRung(h264)).toBe(true);
    expect(copiesTopRung({ ...h264, videoCodec: 'hevc' })).toBe(false);
    expect(copiesTopRung({ ...h264, pixelFormat: 'yuv420p10le' })).toBe(false);
    expect(copiesTopRung({ ...h264, height: 1088 })).toBe(false);
    expect(copiesTopRung({ ...h264, videoBitrate: 20_000_000 })).toBe(false);
    expect(copiesTopRung({ ...h264, videoBitrate: undefined })).toBe(false);
    expect(copiesTopRung({ ...h264, rotated: true })).toBe(false);
  });

  it('copies video and AAC sound of the top rung and encodes only the lower ones', () => {
    const args = hlsArguments('/tmp/in.mp4', h264);

    expect(valueAfter(args, '-filter_complex')).toBe('[0:v]split=2[s1][s2];[s1]scale=-2:720[o1];[s2]scale=-2:360[o2]');
    expect(valueAfter(args, '-c:v:0')).toBe('copy');
    expect(valueAfter(args, '-c:v:1')).toBe('libx264');
    expect(args).not.toContain('-preset:v:0');
    expect(valueAfter(args, '-c:a')).toBe('copy');
    expect(valueAfter(args, '-var_stream_map')).toBe('v:0,a:0,name:1080p v:1,a:1,name:720p v:2,a:2,name:360p');
  });

  it('needs no filter when the only rung is copied, and encodes sound that is not AAC', () => {
    const args = hlsArguments('/tmp/in.mp4', { ...h264, height: 360, videoBitrate: 700_000, audioCodec: 'mp3' });

    expect(args).not.toContain('-filter_complex');
    expect(valueAfter(args, '-c:v:0')).toBe('copy');
    expect(valueAfter(args, '-c:a')).toBe('aac');
  });
});

describe('ffprobe codecs', () => {
  it('reads codec, pixel format and bitrate, falling back to the file bitrate', () => {
    const json = JSON.stringify({
      format: { duration: '10', bit_rate: '3000000' },
      streams: [
        { codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p', height: 720 },
        { codec_type: 'audio', codec_name: 'aac' },
      ],
    });
    expect(parseFfprobe(json)).toMatchObject({
      videoCodec: 'h264',
      pixelFormat: 'yuv420p',
      audioCodec: 'aac',
      videoBitrate: 3_000_000,
    });
    const silent = JSON.stringify({ format: { duration: '10' }, streams: [{ codec_type: 'video', height: 720 }] });
    expect(parseFfprobe(silent).videoBitrate).toBeUndefined();
    const phone = (stream: object) =>
      JSON.stringify({ format: { duration: '10' }, streams: [{ codec_type: 'video', height: 1080, ...stream }] });
    expect(parseFfprobe(phone({ side_data_list: [{ rotation: -90 }] })).rotated).toBe(true);
    expect(parseFfprobe(phone({ tags: { rotate: '90' } })).rotated).toBe(true);
    expect(parseFfprobe(phone({ side_data_list: [{ rotation: 0 }] })).rotated).toBe(false);
  });
});

describe('soft subtitles', () => {
  it('lists subtitle streams with their place among subtitles, language tag and title', () => {
    const json = JSON.stringify({
      format: { duration: '10' },
      streams: [
        { codec_type: 'video', height: 720 },
        { codec_type: 'subtitle', codec_name: 'mov_text', tags: { language: 'vie' } },
        { codec_type: 'audio', codec_name: 'aac' },
        { codec_type: 'subtitle', codec_name: 'subrip', tags: { language: 'und', title: 'English' } },
      ],
    });
    expect(parseFfprobe(json).subtitles).toEqual([
      { position: 0, codec: 'mov_text', language: 'vie', title: undefined },
      { position: 1, codec: 'subrip', language: 'und', title: 'English' },
    ]);
  });

  it('converts one subtitle stream to WebVTT', () => {
    const args = subtitleArguments('/tmp/in.mp4', 2, '/tmp/out/vi.vtt');

    expect(valueAfter(args, '-i')).toBe('/tmp/in.mp4');
    expect(valueAfter(args, '-map')).toBe('0:s:2');
    expect(valueAfter(args, '-c:s')).toBe('webvtt');
    expect(args.at(-1)).toBe('/tmp/out/vi.vtt');
  });

  it('keeps subtitles out of the HLS renditions, so the copy path is unchanged', () => {
    const args = hlsArguments('/tmp/in.mp4', {
      durationSeconds: 60,
      height: 360,
      hasAudio: true,
      videoCodec: 'h264',
      pixelFormat: 'yuv420p',
      audioCodec: 'aac',
      videoBitrate: 700_000,
      subtitles: [{ position: 0, codec: 'mov_text', language: 'vie' }],
    });

    expect(args.filter((arg) => arg.startsWith('0:s'))).toEqual([]);
    expect(valueAfter(args, '-c:v:0')).toBe('copy');
  });
});
