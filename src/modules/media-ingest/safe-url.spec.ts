import { assertPublicUrl, isBlockedAddress, UnsafeUrlError } from './safe-url';

const strict = { allowPrivate: false };

describe('Import URL guard (SSRF)', () => {
  it.each(['127.0.0.1', '10.1.2.3', '172.20.0.5', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0'])(
    'blocks the internal IPv4 address %s',
    (address) => expect(isBlockedAddress(address)).toBe(true),
  );

  it.each(['::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1'])(
    'blocks the internal IPv6 address %s',
    (address) => expect(isBlockedAddress(address)).toBe(true),
  );

  it.each(['8.8.8.8', '104.16.0.1', '2606:4700::1111'])('lets the public address %s through', (address) =>
    expect(isBlockedAddress(address)).toBe(false),
  );

  it.each([
    ['file:///etc/passwd', 'Only http and https'],
    ['ftp://example.com/a.mp4', 'Only http and https'],
    ['http://user:secret@example.com/a.mp4', 'user name or password'],
    ['http://127.0.0.1:5432/', 'private or local'],
    ['http://[::1]/a.m3u8', 'private or local'],
    ['http://169.254.169.254/latest/meta-data/', 'private or local'],
    ['not a url', 'not a valid URL'],
  ])('refuses %s', async (url, message) => {
    await expect(assertPublicUrl(url, strict)).rejects.toThrow(UnsafeUrlError);
    await expect(assertPublicUrl(url, strict)).rejects.toThrow(message);
  });

  it('lets private addresses through only when development allows them', async () => {
    await expect(assertPublicUrl('http://127.0.0.1:8080/a.m3u8', { allowPrivate: true })).resolves.toBeInstanceOf(URL);
  });
});
