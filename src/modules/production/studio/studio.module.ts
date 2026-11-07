import { Module } from '@nestjs/common';
import { StudioController } from './studio.controller';
import { StudioAccountService } from './studio-account.service';
import { StudioService } from './studio.service';

@Module({
  controllers: [StudioController],
  providers: [StudioService, StudioAccountService],
  exports: [StudioService, StudioAccountService],
})
export class StudioModule {}
