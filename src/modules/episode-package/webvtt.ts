export interface SubtitleCue {
  text: string;
  durationSeconds: number;
}

function timestamp(totalSeconds: number): string {
  const ms = Math.round(totalSeconds * 1000);
  const pad = (value: number, size = 2) => String(value).padStart(size, '0');
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(ms % 1000, 3)}`;
}

/** Lays cues back to back — one per scene, each lasting as long as that scene's video. */
export function buildWebVtt(cues: SubtitleCue[]): string {
  const blocks = ['WEBVTT'];
  let start = 0;
  cues.forEach((cue, index) => {
    const end = start + cue.durationSeconds;
    blocks.push(`${index + 1}\n${timestamp(start)} --> ${timestamp(end)}\n${cue.text.trim()}`);
    start = end;
  });
  return `${blocks.join('\n\n')}\n`;
}
