import { Controller, Delete, Get, Headers, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { DeviceService } from './device.service';

const ID = new ParseUUIDPipe({ version: '4' });

/** MF-4: a member's registered devices and live streams, and the actions that free a slot. */
@ApiTags('devices')
@ApiBearerAuth()
@Controller('devices')
export class DeviceController {
  constructor(private readonly devices: DeviceService) {}

  @Get()
  @ApiHeader({ name: 'X-Device-Id', required: false, description: "The caller's own device, flagged current" })
  @ApiOperation({ summary: 'Registered devices, live streams and the limits of the current plan' })
  overview(@CurrentUser() user: AuthenticatedUser, @Headers('x-device-id') deviceKey?: string) {
    return this.devices.overview(user.id, deviceKey);
  }

  @Delete(':deviceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a registered device and end what it is playing' })
  remove(@Param('deviceId', ID) deviceId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.devices.remove(user.id, deviceId);
  }

  @Post('sessions/:sessionId/end')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'End one of your live streams so another device can play' })
  endSession(@Param('sessionId', ID) sessionId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.devices.endSession(user.id, sessionId);
  }
}
