import { INestApplication, ValidationPipe } from '@nestjs/common';

/** Global prefix and request validation shared by the server and the e2e suite. */
export function configureApp(app: INestApplication) {
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
}
