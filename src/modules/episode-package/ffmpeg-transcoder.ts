import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { Logger } from '@nestjs/common';
import type { MediaStorage } from 'src/modules/generation-job/providers/media-storage';
import type { SceneClip, TranscodedCut, VideoTranscoder } from './video-transcoder';

/** The HLS ladder of LI-02, highest first: output height and video bitrate. */
export const HLS_LADDER = [
  { name: '1080p', height: 1080, bitrate: '5000k' },
  { name: '720p', height: 720, bitrate: '2800k' },
  { name: '360p', height: 360, bitrate: '800k' },
];

const FRAME = { width: 1920, height: 1080, fps: 24 };
const SEGMENT_SECONDS = 4;
const TIMEOUT_MS = 10 * 60_000;

const MIME: Record<string, string> = { '.m3u8': 'application/vnd.apple.mpegurl', '.ts': 'video/mp2t' };

/**
 * FFmpeg arguments that join the clips into one video and encode it as an HLS master
 * playlist with one rendition per HLS_LADDER rung. Each clip is first fitted into the
 * same 16:9 frame and frame rate, since the models return different sizes. Output paths
 * are relative: ffmpeg runs inside the work folder.
 */
export function hlsArguments(inputs: string[]): string[] {
  const fit = inputs.map(
    (_, i) =>
      `[${i}:v]scale=${FRAME.width}:${FRAME.height}:force_original_aspect_ratio=decrease,` +
      `pad=${FRAME.width}:${FRAME.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${FRAME.fps}[c${i}]`,
  );
  const joined = `${inputs.map((_, i) => `[c${i}]`).join('')}concat=n=${inputs.length}:v=1:a=0[cut]`;
  const split = `[cut]split=${HLS_LADDER.length}${HLS_LADDER.map((_, i) => `[s${i}]`).join('')}`;
  const scaled = HLS_LADDER.map((rung, i) => `[s${i}]scale=-2:${rung.height}[o${i}]`);

  return [
    '-y',
    ...inputs.flatMap((input) => ['-i', input]),
    '-filter_complex',
    [...fit, joined, split, ...scaled].join(';'),
    ...HLS_LADDER.flatMap((rung, i) => ['-map', `[o${i}]`, `-c:v:${i}`, 'libx264', `-b:v:${i}`, rung.bitrate]),
    ...['-preset', 'veryfast', '-g', String(FRAME.fps * SEGMENT_SECONDS), '-sc_threshold', '0'],
    ...['-f', 'hls', '-hls_time', String(SEGMENT_SECONDS), '-hls_playlist_type', 'vod'],
    ...['-hls_segment_filename', '%v/seg_%03d.ts'],
    ...['-master_pl_name', 'master.m3u8'],
    ...['-var_stream_map', HLS_LADDER.map((rung, i) => `v:${i},name:${rung.name}`).join(' ')],
    '%v/index.m3u8',
  ];
}

function runFfmpeg(binary: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { cwd, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => (stderr = (stderr + chunk.toString()).slice(-4000)));
    const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_MS);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(new Error(`Cannot start ffmpeg ("${binary}"): ${error.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with ${code}: ${stderr.split('\n').slice(-5).join(' ')}`));
    });
  });
}

async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries.filter((e) => e.isFile()).map((e) => path.join(e.parentPath, e.name));
}

/**
 * Real LI-02 transcoder: renders the cut with FFmpeg and uploads the whole HLS folder
 * (master playlist, one playlist and its segments per rendition) to media storage.
 * Clips are read straight from their public URLs. The cut is picture only; voice-over
 * and music stay separate assets for now.
 */
export class FfmpegVideoTranscoder implements VideoTranscoder {
  private readonly logger = new Logger(FfmpegVideoTranscoder.name);

  constructor(
    private readonly storage: MediaStorage,
    private readonly ffmpegPath = 'ffmpeg',
  ) {}

  async transcode(clips: SceneClip[]): Promise<TranscodedCut> {
    if (!this.storage.isConfigured) throw new Error('VIDEO_TRANSCODER=ffmpeg needs media storage (S3_* settings)');

    const workDir = await mkdtemp(path.join(tmpdir(), 'aicinema-cut-'));
    try {
      const started = Date.now();
      await runFfmpeg(this.ffmpegPath, hlsArguments(clips.map((clip) => clip.storageKey)), workDir);

      const prefix = `episodes/${randomUUID()}`;
      let streamUrl = '';
      for (const file of await filesUnder(workDir)) {
        const key = `${prefix}/${path.relative(workDir, file).split(path.sep).join('/')}`;
        const url = await this.storage.uploadAt(
          key,
          await readFile(file),
          MIME[path.extname(file)] ?? 'application/octet-stream',
        );
        if (key.endsWith('/master.m3u8')) streamUrl = url;
      }
      this.logger.log(
        `Transcoded ${clips.length} clip(s) into ${prefix} in ${Math.round((Date.now() - started) / 1000)}s`,
      );

      return {
        streamUrl,
        qualities: [...HLS_LADDER].reverse().map((rung) => rung.name),
        durationSeconds: clips.reduce((sum, clip) => sum + clip.durationSeconds, 0),
      };
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }
}
