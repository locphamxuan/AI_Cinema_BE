import { Global, Module } from '@nestjs/common';
import { EmailOutboxService } from './email-outbox.service';

@Global()
@Module({ providers: [EmailOutboxService], exports: [EmailOutboxService] })
export class EmailModule {}
