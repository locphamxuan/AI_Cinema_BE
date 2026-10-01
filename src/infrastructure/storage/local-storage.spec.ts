import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { LocalObjectStorage } from './local-storage';
import { contentTypeOf } from './object-storage';

describe('LocalObjectStorage', () => {
  let root: string;
  let storage: LocalObjectStorage;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'storage-spec-'));
    storage = new LocalObjectStorage(root, 'http://localhost:3001/media/public');
  });

  afterEach(() => rm(root, { recursive: true, force: true }));

  it('keeps public and private objects apart and serves only public ones by URL', async () => {
    await storage.putBuffer('movies/m1/brief.pdf', Buffer.from('brief'), 'application/pdf', 'private');
    const source = path.join(root, 'clip.vtt');
    await writeFile(source, 'WEBVTT');
    await storage.putFile('media/a1/en.vtt', source, 'text/vtt', 'public');

    await expect(storage.read('movies/m1/brief.pdf', 'private')).resolves.toEqual(Buffer.from('brief'));
    await expect(storage.read('movies/m1/brief.pdf', 'public')).rejects.toThrow();
    expect(storage.publicUrl('media/a1/en.vtt')).toBe('http://localhost:3001/media/public/media/a1/en.vtt');
    expect(storage.publicRoot).toBe(path.resolve(root, 'public'));
  });

  it('refuses keys that could escape the storage folder', async () => {
    await expect(storage.read('../secrets.env', 'private')).rejects.toThrow('Unsafe storage key');
    expect(() => storage.publicUrl('/etc/passwd')).toThrow('Unsafe storage key');
  });

  it('knows the content types of the files it serves', () => {
    expect(contentTypeOf('master.m3u8')).toBe('application/vnd.apple.mpegurl');
    expect(contentTypeOf('SEG_001.TS')).toBe('video/mp2t');
    expect(contentTypeOf('notes')).toBe('application/octet-stream');
  });
});
