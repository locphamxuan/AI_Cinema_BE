import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from 'src/common/decorators/roles.decorator';
import { MF1_ROLES } from 'src/common/auth/mf1-roles';
import { AiModelRouterService } from './ai-model-router.service';

@ApiTags('ai-models')
@ApiBearerAuth()
@Roles(...MF1_ROLES)
@Controller('ai-models')
export class AiModelController {
  constructor(private readonly router: AiModelRouterService) {}

  @Get('routing')
  @ApiOperation({ summary: 'Model and planning token estimate each generation job type is routed to (BR-40, BR-41)' })
  routing() {
    return this.router.routingTable();
  }
}
