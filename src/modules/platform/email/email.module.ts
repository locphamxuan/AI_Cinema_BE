import { Global, Module } from '@nestjs/common';
import { EmailOutboxService } from './email-outbox.service';
import { EmailRedeliverySweep } from './email-redelivery.sweep';

@Global()
@Module({ providers: [EmailOutboxService, EmailRedeliverySweep], exports: [EmailOutboxService] })
export class EmailModule {}
