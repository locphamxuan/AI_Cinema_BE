import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { HLS_LADDER } from 'src/common/hls/quality-ladder';

const SEGMENT_SECONDS = 4;

export interface ProbedFile {
  durationSeconds: number;
  height: number;
  hasAudio: boolean;
  /** ffprobe codec names, e.g. 'h264' / 'aac'; absent when unknown. */
  videoCodec?: string;
  pixelFormat?: string;
  audioCodec?: string;
  /** Bits per second of the video stream (or of the whole file when the stream does not say). */
  videoBitrate?: number;
}

export interface TranscodedHls {
  /** Folder holding master.m3u8 and one sub-folder per rendition. */
  outputDir: string;
  /** Lowest first, e.g. ['360p', '720p']. */
  qualities: string[];
}

/** Reads and transcodes delivered video files; FFmpeg in real use, a stand-in in tests (MEDIA_PIPELINE). */
export abstract class MediaProcessor {
  /** Duration, picture height and audio of a local video or an http(s) link; rejects one that holds no video. */
  abstract probe(inputPath: string): Promise<ProbedFile>;

  /** Encodes `inputPath` into an HLS master playlist under `outputDir`. */
  abstract transcode(inputPath: string, outputDir: string, probed: ProbedFile): Promise<TranscodedHls>;
}

/** Rungs worth encoding: never upscale, but always keep at least the lowest one. */
export function ladderFor(sourceHeight: number) {
  const rungs = HLS_LADDER.filter((rung) => rung.height <= sourceHeight);
  return rungs.length ? rungs : HLS_LADDER.slice(-1);
}

/** A copied stream may run at most this much above the bitrate of its rung, so phones can still play it. */
const COPY_BITRATE_HEADROOM = 1.6;

const bitsPerSecond = (bitrate: string) => Number.parseInt(bitrate, 10) * 1000;

/**
 * Whether the top rung can be the source video as it is, without encoding it again: H.264 in 8-bit
 * 4:2:0 (what most editors export), exactly the height of the rung and not far above its bitrate.
 * Encoding the top rung is most of the work, so a delivery like that is ready several times sooner.
 */
export function copiesTopRung(probed: ProbedFile): boolean {
  const top = ladderFor(probed.height)[0];
  return (
    probed.videoCodec === 'h264' &&
    probed.pixelFormat === 'yuv420p' &&
    probed.height === top.height &&
    (probed.videoBitrate ?? 0) > 0 &&
    probed.videoBitrate! <= bitsPerSecond(top.bitrate) * COPY_BITRATE_HEADROOM
  );
}

/**
 * FFmpeg arguments that encode one input into an HLS VOD master playlist with one rendition
 * per rung. Keyframes are forced every segment so every rendition switches cleanly.
 * Output paths are relative: ffmpeg runs inside the output folder.
 */
export function hlsArguments(inputPath: string, probed: ProbedFile): string[] {
  const rungs = ladderFor(probed.height);
  const copied = copiesTopRung(probed) ? 1 : 0;
  // Output stream i is rung i; the copied one (if any) is 0 and the rest are scaled from the source.
  const encoded = rungs.map((_, i) => i).slice(copied);
  const split = `[0:v]split=${encoded.length}${encoded.map((i) => `[s${i}]`).join('')}`;
  const scaled = encoded.map((i) => `[s${i}]scale=-2:${rungs[i].height}[o${i}]`);
  const audio = probed.hasAudio;
  const encode = (i: number) => [
    ...['-map', `[o${i}]`, `-c:v:${i}`, 'libx264', `-b:v:${i}`, rungs[i].bitrate],
    ...[`-preset:v:${i}`, 'veryfast', `-pix_fmt:v:${i}`, 'yuv420p', `-sc_threshold:v:${i}`, '0'],
    ...[`-force_key_frames:v:${i}`, `expr:gte(t,n_forced*${SEGMENT_SECONDS})`],
  ];

  return [
    '-y',
    ...['-i', inputPath],
    ...(encoded.length ? ['-filter_complex', [split, ...scaled].join(';')] : []),
    ...(copied ? ['-map', '0:v:0', '-c:v:0', 'copy'] : []),
    ...encoded.flatMap(encode),
    ...(audio ? rungs.flatMap(() => ['-map', '0:a:0']) : []),
    ...(audio && probed.audioCodec === 'aac' ? ['-c:a', 'copy'] : []),
    ...(audio && probed.audioCodec !== 'aac' ? ['-c:a', 'aac', '-b:a', '128k', '-ac', '2'] : []),
    ...['-f', 'hls', '-hls_time', String(SEGMENT_SECONDS), '-hls_playlist_type', 'vod'],
    ...['-hls_segment_filename', '%v/seg_%03d.ts', '-master_pl_name', 'master.m3u8'],
    ...['-var_stream_map', rungs.map((r, i) => `v:${i},${audio ? `a:${i},` : ''}name:${r.name}`).join(' ')],
    '%v/index.m3u8',
  ];
}

interface FfprobeOutput {
  format?: { duration?: string; bit_rate?: string };
  streams?: { codec_type?: string; codec_name?: string; pix_fmt?: string; height?: number; bit_rate?: string }[];
}

export function parseFfprobe(json: string): ProbedFile {
  const output = JSON.parse(json) as FfprobeOutput;
  const video = output.streams?.find((stream) => stream.codec_type === 'video');
  const duration = Number(output.format?.duration);
  if (!video?.height) throw new Error('The file holds no video stream');
  if (!(duration > 0)) throw new Error('The duration of the video cannot be read');
  const audio = output.streams?.find((stream) => stream.codec_type === 'audio');
  const bitrate = Number(video.bit_rate ?? output.format?.bit_rate);
  return {
    durationSeconds: Math.round(duration),
    height: video.height,
    hasAudio: Boolean(audio),
    videoCodec: video.codec_name,
    pixelFormat: video.pix_fmt,
    audioCodec: audio?.codec_name,
    videoBitrate: bitrate > 0 ? bitrate : undefined,
  };
}

function run(binary: string, args: string[], options: { cwd?: string; timeoutMs: number }): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr = (stderr + chunk.toString()).slice(-4000)));
    const timer = setTimeout(() => child.kill('SIGKILL'), options.timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(new Error(`Cannot start ${path.basename(binary)}: ${error.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`${path.basename(binary)} exited with ${code}: ${stderr.split('\n').slice(-4).join(' ')}`));
    });
  });
}

export class FfmpegMediaProcessor extends MediaProcessor {
  constructor(
    private readonly ffmpegPath: string,
    private readonly ffprobePath: string,
  ) {
    super();
  }

  async probe(inputPath: string): Promise<ProbedFile> {
    const json = await run(
      this.ffprobePath,
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', inputPath],
      { timeoutMs: 60_000 },
    ).catch((error: Error) => {
      throw new Error(`The file is not a readable video (${error.message})`);
    });
    return parseFfprobe(json);
  }

  async transcode(inputPath: string, outputDir: string, probed: ProbedFile): Promise<TranscodedHls> {
    await mkdir(outputDir, { recursive: true });
    // Encoding takes a few times the running length on a small worker; give it room, but not forever.
    const timeoutMs = Math.max(10 * 60_000, probed.durationSeconds * 6_000);
    await run(this.ffmpegPath, hlsArguments(path.resolve(inputPath), probed), { cwd: outputDir, timeoutMs });
    return {
      outputDir,
      qualities: ladderFor(probed.height)
        .map((rung) => rung.name)
        .reverse(),
    };
  }
}

/** MEDIA_PIPELINE=mock: accepts any file as a 60-second 1080p video and writes a placeholder playlist. */
export class MockMediaProcessor extends MediaProcessor {
  probe(): Promise<ProbedFile> {
    return Promise.resolve({ durationSeconds: 60, height: 1080, hasAudio: true });
  }

  async transcode(_inputPath: string, outputDir: string): Promise<TranscodedHls> {
    await mkdir(outputDir, { recursive: true });
    await writeFile(
      path.join(outputDir, 'master.m3u8'),
      HLS_LADDER.map((r) => `#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=1x${r.height}\n${r.name}/index.m3u8`)
        .reverse()
        .join('\n')
        .replace(/^/, '#EXTM3U\n'),
    );
    return { outputDir, qualities: [...HLS_LADDER].reverse().map((rung) => rung.name) };
  }
}
