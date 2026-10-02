import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Paginate, type PaginateQuery } from '@nestarc/pagination';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { NotificationService } from './notification.service';

/** The bell of the portal and the app: each account only ever sees its own notifications. */
@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  @Get()
  findMine(@CurrentUser('id') userId: string, @Paginate() query: PaginateQuery) {
    return this.notifications.findMine(userId, query);
  }

  @Get('unread-count')
  unreadCount(@CurrentUser('id') userId: string) {
    return this.notifications.unreadCount(userId);
  }

  @Patch('read-all')
  markAllRead(@CurrentUser('id') userId: string) {
    return this.notifications.markAllRead(userId);
  }

  @Patch(':notificationId/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  markRead(@CurrentUser('id') userId: string, @Param('notificationId', ParseUUIDPipe) notificationId: string) {
    return this.notifications.markRead(userId, notificationId);
  }
}
