import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';
import { LocalObjectStorage } from './local-storage';
import { ObjectStorage } from './object-storage';
import { S3ObjectStorage } from './s3-storage';

@Global()
@Module({
  providers: [
    {
      provide: ObjectStorage,
      inject: [APP_CONFIG],
      useFactory: ({ storage }: AppConfig): ObjectStorage =>
        storage.driver === 's3'
          ? new S3ObjectStorage(storage)
          : new LocalObjectStorage(storage.localRoot, `${storage.publicBaseUrl}/public`),
    },
  ],
  exports: [ObjectStorage],
})
export class StorageModule {}
