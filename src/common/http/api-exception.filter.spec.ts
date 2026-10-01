import { ArgumentsHost, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ApiExceptionFilter } from './api-exception.filter';

function hostFor(response: { status: jest.Mock; json: jest.Mock }) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ method: 'GET', url: '/api/x', headers: { 'x-request-id': 'req-12345678' } }),
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;
}

describe('ApiExceptionFilter', () => {
  const filter = new ApiExceptionFilter();
  let response: { status: jest.Mock; json: jest.Mock };

  beforeEach(() => {
    response = { status: jest.fn(), json: jest.fn() };
    response.status.mockReturnValue(response);
  });

  it('wraps an HTTP error in the API error envelope', () => {
    filter.catch(new NotFoundException('Movie not found'), hostFor(response));
    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.json).toHaveBeenCalledWith({
      error: { code: 'NOT_FOUND', message: 'Movie not found', details: undefined },
      requestId: 'req-12345678',
    });
  });

  it('lists validation messages as details', () => {
    filter.catch(new BadRequestException(['title must be a string']), hostFor(response));
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: { code: 'BAD_REQUEST', message: 'The request is invalid', details: ['title must be a string'] },
      }),
    );
  });

  it('keeps the details a service attaches to its error', () => {
    filter.catch(new ConflictException({ message: 'Not ready', details: ['a Coin price'] }), hostFor(response));
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: { code: 'CONFLICT', message: 'Not ready', details: ['a Coin price'] } }),
    );
  });

  it('turns a unique-key violation into a 409', () => {
    const error = new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' });
    filter.catch(error, hostFor(response));
    expect(response.status).toHaveBeenCalledWith(409);
  });

  it('hides the details of an unexpected error', () => {
    jest.spyOn(filter['logger'], 'error').mockImplementation(() => undefined);
    filter.catch(new Error('connection string leaked'), hostFor(response));
    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } }),
    );
  });
});
