import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import type { AppConfig } from 'src/config/app-config';
import { FilmSentController } from './film-sent.controller';
import type { FilmSentRequestDto } from './film-sent.request.dto';

const dto = {} as FilmSentRequestDto;

function controller(webhookToken: string | null) {
  const filmSent = { record: jest.fn().mockResolvedValue({ handoffId: 'h1' }) };
  const config = { studio: { webhookToken } } as AppConfig;
  return { controller: new FilmSentController(filmSent as never, config), filmSent };
}

describe('FilmSentController', () => {
  it('records the film when the token matches', async () => {
    const { controller: c, filmSent } = controller('secret');

    await expect(c.record('secret', dto)).resolves.toEqual({ handoffId: 'h1' });
    expect(filmSent.record).toHaveBeenCalledWith(dto);
  });

  it.each([undefined, 'wrong', 'secret-longer'])('refuses the token %s', (token) => {
    const { controller: c, filmSent } = controller('secret');

    expect(() => c.record(token, dto)).toThrow(UnauthorizedException);
    expect(filmSent.record).not.toHaveBeenCalled();
  });

  it('stays closed when no token is configured', () => {
    expect(() => controller(null).controller.record('anything', dto)).toThrow(ServiceUnavailableException);
  });
});
