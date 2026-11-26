import { ValidationPipe } from '@nestjs/common';
import { RevenueQueryDto } from './revenue.query.dto';

/** The global pipe (app.setup.ts), whose implicit conversion turns any non-empty string into true. */
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  transformOptions: { enableImplicitConversion: true },
});
const parse = (query: object) =>
  pipe.transform(query, { type: 'query', metatype: RevenueQueryDto }) as Promise<RevenueQueryDto>;

describe('RevenueQueryDto', () => {
  it('reads byDay=false as false and byDay=true as true', async () => {
    await expect(parse({ byDay: 'false' })).resolves.toMatchObject({ byDay: false });
    await expect(parse({ byDay: 'true' })).resolves.toMatchObject({ byDay: true });
    await expect(parse({})).resolves.toMatchObject({ byDay: undefined });
  });

  it('refuses a byDay that is not a boolean', async () => {
    await expect(parse({ byDay: 'yes' })).rejects.toThrow();
  });
});
