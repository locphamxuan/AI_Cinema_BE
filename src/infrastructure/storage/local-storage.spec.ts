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

  it('signs no direct upload, but stats, reads the head of and moves an object', async () => {
    await storage.putBuffer('uploads/u1/source.mp4', Buffer.from('0123456789abcdefXYZ'), 'video/mp4', 'private');

    await expect(storage.presignPut()).resolves.toBeNull();
    await expect(storage.stat('uploads/u1/source.mp4', 'private')).resolves.toEqual({ size: 19 });
    await expect(storage.stat('uploads/none.mp4', 'private')).resolves.toBeNull();
    await expect(storage.readHead('uploads/u1/source.mp4', 'private', 16)).resolves.toEqual(
      Buffer.from('0123456789abcdef'),
    );
    await expect(storage.readHead('uploads/u1/source.mp4', 'private', 64)).resolves.toHaveLength(19);

    await storage.move('uploads/u1/source.mp4', 'media/u1/source.mp4', 'private');
    await expect(storage.stat('uploads/u1/source.mp4', 'private')).resolves.toBeNull();
    await expect(storage.stat('media/u1/source.mp4', 'private')).resolves.toEqual({ size: 19 });
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
