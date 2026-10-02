import { mediaPlaylistDuration, parseMasterPlaylist } from './hls-playlist';

const MASTER = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2"
1080p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360
https://cdn.example/360p/index.m3u8
`;

const VOD = `#EXTM3U
#EXT-X-TARGETDURATION:4
#EXTINF:4.000,
seg_000.ts
#EXTINF:4.000,
seg_001.ts
#EXTINF:2.5,
seg_002.ts
#EXT-X-ENDLIST
`;

describe('HLS playlist checks (BR-17)', () => {
  it('reads every variant of a master playlist with absolute URIs and heights', () => {
    expect(parseMasterPlaylist(MASTER, 'https://studio.example/ep1/master.m3u8')).toEqual([
      { uri: 'https://studio.example/ep1/1080p/index.m3u8', height: 1080, bandwidth: 5000000 },
      { uri: 'https://cdn.example/360p/index.m3u8', height: 360, bandwidth: 800000 },
    ]);
  });

  it('finds no variant in a media playlist', () => {
    expect(parseMasterPlaylist(VOD, 'https://studio.example/ep1/index.m3u8')).toEqual([]);
  });

  it('refuses what is not a playlist', () => {
    expect(() => parseMasterPlaylist('<html></html>', 'https://x.example/')).toThrow('#EXTM3U');
  });

  it('adds up the segments of a VOD playlist', () => {
    expect(mediaPlaylistDuration(VOD)).toBe(11);
  });

  it('refuses a live playlist, which has no end', () => {
    expect(() => mediaPlaylistDuration(VOD.replace('#EXT-X-ENDLIST', ''))).toThrow('live or unfinished');
  });

  it('refuses a playlist without segments', () => {
    expect(() => mediaPlaylistDuration('#EXTM3U\n#EXT-X-ENDLIST')).toThrow('no segment');
  });
});
