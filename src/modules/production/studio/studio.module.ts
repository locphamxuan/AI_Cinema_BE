import { Module } from '@nestjs/common';
import { StudioController } from './studio.controller';
import { StudioAccountService } from './studio-account.service';
import { StudioMailService } from './studio-mail.service';
import { StudioService } from './studio.service';

@Module({
  controllers: [StudioController],
  providers: [StudioService, StudioAccountService, StudioMailService],
  exports: [StudioService, StudioAccountService, StudioMailService],
})
export class StudioModule {}
