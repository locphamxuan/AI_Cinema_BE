import { buildWebVtt } from './webvtt';

describe('buildWebVtt', () => {
  it('lays one cue per scene back to back', () => {
    const vtt = buildWebVtt([
      { text: 'Mưa rơi trên phố neon.', durationSeconds: 8 },
      { text: ' Anh ấy quay lại. ', durationSeconds: 3725.5 },
    ]);

    expect(vtt).toBe(
      [
        'WEBVTT',
        '',
        '1',
        '00:00:00.000 --> 00:00:08.000',
        'Mưa rơi trên phố neon.',
        '',
        '2',
        '00:00:08.000 --> 01:02:13.500',
        'Anh ấy quay lại.',
        '',
      ].join('\n'),
    );
  });
});
