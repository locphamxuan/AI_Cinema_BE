import { Logger } from '@nestjs/common';
import { removeQuietly } from './remove-quietly';

describe('removeQuietly', () => {
  const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  const storage = { remove: jest.fn() };

  beforeEach(() => jest.clearAllMocks());
  afterAll(() => warn.mockRestore());

  it('removes the object and logs nothing', async () => {
    storage.remove.mockResolvedValue(undefined);
    await removeQuietly(storage, 'movies/a.pdf', 'private');
    expect(storage.remove).toHaveBeenCalledWith('movies/a.pdf', 'private');
    expect(warn).not.toHaveBeenCalled();
  });

  it('logs the key and the reason instead of throwing', async () => {
    storage.remove.mockRejectedValue(new Error('storage down'));
    await expect(removeQuietly(storage, 'movies/a.pdf', 'public')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith('Could not remove public object movies/a.pdf: storage down');
  });
});
