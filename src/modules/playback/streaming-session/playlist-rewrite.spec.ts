import { isHlsPlaylist, selectVariants, variantLines } from './playlist-rewrite';

const STREAM_URL = 'https://cdn.example.com/public/hls/asset-1/master.m3u8';

const MASTER = [
  '#EXTM3U',
  '#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080',
  '1080p/index.m3u8',
  '#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720',
  '720p/index.m3u8',
  '#EXT-X-STREAM-INF:BANDWIDTH=900000',
  'audio-only/index.m3u8',
].join('\n');

describe('playlist-rewrite', () => {
  it('tells an HLS playlist from a progressive file', () => {
    expect(isHlsPlaylist('https://x/master.m3u8')).toBe(true);
    expect(isHlsPlaylist('https://x/master.M3U8?token=1')).toBe(true);
    expect(isHlsPlaylist('https://x/movie.mp4')).toBe(false);
    expect(isHlsPlaylist('https://x/master.m3u8.mp4')).toBe(false);
  });

  it('keeps renditions at or below the ceiling and those without a resolution', () => {
    const variants = selectVariants(MASTER, STREAM_URL, 720);
    expect(variants.map((variant) => variant.folder)).toEqual(['720p', 'audio-only']);
    expect(variants[0].tag).toBe('#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720');
  });

  it('skips a stream tag with no URI line after it', () => {
    const raw = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n#EXT-X-ENDLIST';
    expect(selectVariants(raw, STREAM_URL, 1080)).toEqual([]);
  });

  it('splits a rendition playlist into raw lines, segments and signable map tags', () => {
    const raw = [
      '#EXTM3U',
      '#EXT-X-MAP:URI="init.mp4",BYTERANGE="720@0"',
      '#EXTINF:6.0,',
      'seg_000.m4s?v=2',
      '',
      'https://other.example.com/ad.ts',
    ].join('\n');
    const lines = variantLines(raw, '720p', STREAM_URL);
    expect(lines[0]).toEqual({ kind: 'raw', line: '#EXTM3U' });
    expect(lines[1]).toEqual({
      kind: 'tag',
      prefix: '#EXT-X-MAP:URI="',
      suffix: '",BYTERANGE="720@0"',
      uri: { path: '720p/init.mp4', search: '' },
    });
    expect(lines[2]).toEqual({ kind: 'raw', line: '#EXTINF:6.0,' });
    expect(lines[3]).toEqual({ kind: 'segment', uri: { path: '720p/seg_000.m4s', search: '?v=2' } });
    expect(lines[4]).toEqual({ kind: 'raw', line: '' });
    // Objects outside this asset are never signed.
    expect(lines[5]).toEqual({ kind: 'raw', line: 'https://other.example.com/ad.ts' });
  });

  it('leaves an unquoted map URI outside the asset untouched', () => {
    const line = '#EXT-X-MAP:URI=https://other.example.com/init.mp4';
    expect(variantLines(line, '720p', STREAM_URL)).toEqual([{ kind: 'raw', line }]);
  });
});
