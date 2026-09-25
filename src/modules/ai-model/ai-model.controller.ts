import { Controller, Get, Query } from '@nestjs/common';
import { PERMISSION } from 'src/common/auth/permissions';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AiModelRouterService } from './ai-model-router.service';
import { ResolveRouteQueryDto } from './dto/resolve-route.query.dto';

@ApiTags('ai-models')
@ApiBearerAuth()
@RequirePermission(PERMISSION.PRODUCTION_READ)
@Controller('ai-models')
export class AiModelController {
  constructor(private readonly router: AiModelRouterService) {}

  @Get('routing')
  @ApiOperation({ summary: 'Model and planning token estimate each generation job type is routed to (BR-40, BR-41)' })
  routing() {
    return this.router.routingTable();
  }

  @Get('route')
  @ApiOperation({
    summary: 'Model and planning token estimate one job — including a described CUSTOM function — routes to',
  })
  route(@Query() query: ResolveRouteQueryDto) {
    return this.router.routeFor(query.jobType, query.customFunction);
  }
}
