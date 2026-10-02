import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig, loadConfig } from './app-config';

let current: AppConfig | undefined;

/** The configuration of the running process, read from the environment once. */
export function appConfig(): AppConfig {
  current ??= loadConfig();
  return current;
}

/** Provides the validated AppConfig to every module (inject it with @Inject(APP_CONFIG)). */
@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: appConfig }],
  exports: [APP_CONFIG],
})
export class AppConfigModule {}
