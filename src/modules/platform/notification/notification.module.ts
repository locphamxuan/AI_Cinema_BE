import { Global, Module } from '@nestjs/common';
import { NotificationController } from './notification.controller';
import { NotificationRealtimeDispatcher } from './notification-realtime.dispatcher';
import { NotificationRealtimeGateway } from './notification-realtime.gateway';
import { NotificationService } from './notification.service';

@Global()
@Module({
  controllers: [NotificationController],
  providers: [NotificationService, NotificationRealtimeGateway, NotificationRealtimeDispatcher],
  exports: [NotificationService],
})
export class NotificationModule {}
