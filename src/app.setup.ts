import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { ApiExceptionFilter } from 'src/common/http/api-exception.filter';
import { requestIdMiddleware } from 'src/common/http/request-id.middleware';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';
import { LocalObjectStorage } from 'src/infrastructure/storage/local-storage';
import { ObjectStorage } from 'src/infrastructure/storage/object-storage';

/** Middleware, validation and error handling shared by the server and the e2e suite. */
export function configureApp(app: INestApplication) {
  const config = app.get<AppConfig>(APP_CONFIG);
  const express = app as NestExpressApplication;

  if (config.trustProxy) express.set('trust proxy', 1);
  express.disable('x-powered-by');
  // Swagger UI needs inline scripts, so the Content-Security-Policy is relaxed only where it is served.
  app.use(helmet({ contentSecurityPolicy: config.swaggerEnabled ? false : undefined }));
  app.use(requestIdMiddleware);
  app.enableCors({ origin: config.corsOrigins, credentials: true });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();

  // With the local storage driver the API itself serves the public objects (HLS, artwork).
  const storage = app.get(ObjectStorage);
  if (storage instanceof LocalObjectStorage) {
    const mount = new URL(storage.publicUrl('x')).pathname.replace(/\/x$/, '');
    express.useStaticAssets(storage.publicRoot, { prefix: mount, dotfiles: 'deny', index: false });
  }

  if (config.swaggerEnabled) {
    const document = new DocumentBuilder()
      .setTitle('AI Cinema API')
      .setDescription('AI Cinema - A Coin-Based Streaming System for AI-Generated Movies')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('api/docs', app, () => SwaggerModule.createDocument(app, document));
  }
}
