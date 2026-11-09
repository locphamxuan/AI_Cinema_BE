import { unlink } from 'node:fs/promises';
import { type CallHandler, type ExecutionContext, Logger } from '@nestjs/common';
import { firstValueFrom, of, throwError } from 'rxjs';
import { RemoveTempUploadInterceptor } from './remove-temp-upload.interceptor';

jest.mock('node:fs/promises', () => ({ unlink: jest.fn() }));

describe('RemoveTempUploadInterceptor', () => {
  const unlinkMock = unlink as jest.MockedFunction<typeof unlink>;
  const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  const interceptor = new RemoveTempUploadInterceptor();
  const context = (file?: { path?: string }) =>
    ({ switchToHttp: () => ({ getRequest: () => ({ file }) }) }) as unknown as ExecutionContext;
  const handler = (result = of('ok')): CallHandler => ({ handle: () => result });
  const settled = () => new Promise((resolve) => setImmediate(resolve));

  beforeEach(() => jest.clearAllMocks());
  afterAll(() => warn.mockRestore());

  it('deletes the temporary file once the handler answers', async () => {
    unlinkMock.mockResolvedValue(undefined);
    await firstValueFrom(interceptor.intercept(context({ path: '/tmp/up-1' }), handler()));
    expect(unlinkMock).toHaveBeenCalledWith('/tmp/up-1');
    await settled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('deletes it when the handler fails too, and skips a request without a disk file', async () => {
    unlinkMock.mockResolvedValue(undefined);
    const failing = throwError(() => new Error('rejected'));
    await expect(
      firstValueFrom(interceptor.intercept(context({ path: '/tmp/up-2' }), handler(failing as never))),
    ).rejects.toThrow('rejected');
    expect(unlinkMock).toHaveBeenCalledWith('/tmp/up-2');

    unlinkMock.mockClear();
    await firstValueFrom(interceptor.intercept(context({}), handler()));
    expect(unlinkMock).not.toHaveBeenCalled();
  });

  it('logs the path and the reason when the file cannot be deleted, without failing the request', async () => {
    unlinkMock.mockRejectedValue(new Error('EBUSY'));
    await expect(firstValueFrom(interceptor.intercept(context({ path: '/tmp/up-3' }), handler()))).resolves.toBe('ok');
    await settled();
    expect(warn).toHaveBeenCalledWith('Could not delete temporary upload /tmp/up-3: EBUSY');
  });
});
