import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PERMISSION } from 'src/common/auth/permissions';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { COST_PROOF_MAX_BYTES, CostRequestService } from './cost-request.service';
import {
  ApproveCostRequestDto,
  CostRequestListQueryDto,
  CreateCostRequestDto,
  RejectCostRequestDto,
} from './dto/cost-request.request.dto';

const ID = new ParseUUIDPipe({ version: '4' });

/** "Yêu cầu thêm chi phí sản xuất": the Reviewer asks, the Admin decides. */
@ApiTags('cost-requests')
@ApiBearerAuth()
@Controller()
export class CostRequestController {
  constructor(private readonly requests: CostRequestService) {}

  @Post('projects/:projectId/cost-requests')
  @RequirePermission(PERMISSION.COST_REQUEST)
  @UseInterceptors(FileInterceptor('proof', { limits: { fileSize: COST_PROOF_MAX_BYTES, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { proof: { type: 'string', format: 'binary' } } } })
  @ApiOperation({ summary: 'Reviewer: ask the Admin for more production cost, with the studio quote (≤ 10 MB)' })
  create(
    @Param('projectId', ID) projectId: string,
    @Body() dto: CreateCostRequestDto,
    @UploadedFile() proof: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.requests.create(projectId, dto, proof, user);
  }

  @Get('projects/:projectId/cost-requests')
  listForProject(
    @Param('projectId', ID) projectId: string,
    @Query() query: CostRequestListQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.requests.list(query, user, projectId);
  }

  @Get('cost-requests')
  @ApiOperation({ summary: "The Admin's inbox, or the requests of the Reviewer's own projects; open ones first" })
  list(@Query() query: CostRequestListQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.requests.list(query, user);
  }

  @Get('cost-requests/:requestId/proof')
  @ApiOperation({ summary: 'Download the proof attached to a cost request' })
  proof(@Param('requestId', ID) requestId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.requests.proof(requestId, user);
  }

  @Post('cost-requests/:requestId/approve')
  @RequirePermission(PERMISSION.COST_APPROVE)
  @ApiOperation({ summary: 'Admin: grant what was asked, or less, booked on the project budget' })
  approve(
    @Param('requestId', ID) requestId: string,
    @Body() dto: ApproveCostRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.requests.approve(requestId, dto.grantedVnd, dto.response, user);
  }

  @Post('cost-requests/:requestId/reject')
  @RequirePermission(PERMISSION.COST_APPROVE)
  @ApiOperation({ summary: 'Admin: refuse, with the reason' })
  reject(
    @Param('requestId', ID) requestId: string,
    @Body() dto: RejectCostRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.requests.reject(requestId, dto.response, user);
  }
}
