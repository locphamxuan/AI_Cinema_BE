import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { APP_CONFIG, type AppConfig } from './config/app-config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  await app.listen(app.get<AppConfig>(APP_CONFIG).port);
}
void bootstrap();
