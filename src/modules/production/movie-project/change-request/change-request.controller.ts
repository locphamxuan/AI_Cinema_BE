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
import { CHANGE_PROOF_MAX_BYTES, ChangeRequestService } from './change-request.service';
import {
  ChangeRequestListQueryDto,
  ProposeChangeRequestDto,
  ResolveChangeRequestDto,
} from './dto/change-request.request.dto';

const ID = new ParseUUIDPipe({ version: '4' });

/** BR-55, §4.1.8: the Reviewer or a Creator asks, the Admin decides. */
@ApiTags('change-requests')
@ApiBearerAuth()
@Controller()
export class ChangeRequestController {
  constructor(private readonly changeRequests: ChangeRequestService) {}

  @Post('projects/:movieId/change-requests')
  @RequirePermission(PERMISSION.PROJECT_SUGGEST)
  @UseInterceptors(FileInterceptor('proof', { limits: { fileSize: CHANGE_PROOF_MAX_BYTES, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { proof: { type: 'string', format: 'binary' } } } })
  @ApiOperation({ summary: 'Ask the Admin to change a project, with the reason and the proof (≤ 10 MB)' })
  propose(
    @Param('movieId', ID) movieId: string,
    @Body() dto: ProposeChangeRequestDto,
    @UploadedFile() proof: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.changeRequests.propose(movieId, dto, proof, user);
  }

  @Get('projects/:movieId/change-requests')
  list(@Param('movieId', ID) movieId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.changeRequests.list(movieId, user);
  }

  @Get('change-requests')
  @RequirePermission(PERMISSION.PROJECT_CHANGE_REVIEW)
  @ApiOperation({ summary: "The Admin's inbox: change requests of every project, open ones first" })
  inbox(@Query() query: ChangeRequestListQueryDto) {
    return this.changeRequests.inbox(query.status);
  }

  @Get('change-requests/:changeRequestId/proof')
  @ApiOperation({ summary: 'Download the proof attached to a change request' })
  proof(@Param('changeRequestId', ID) changeRequestId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.changeRequests.proof(changeRequestId, user);
  }

  @Post('change-requests/:changeRequestId/approve')
  @RequirePermission(PERMISSION.PROJECT_CHANGE_REVIEW)
  @ApiOperation({ summary: 'Approve a request; an approved budget supplement is granted to the Reviewer' })
  approve(
    @Param('changeRequestId', ID) changeRequestId: string,
    @Body() dto: ResolveChangeRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.changeRequests.resolve(changeRequestId, true, dto, user);
  }

  @Post('change-requests/:changeRequestId/reject')
  @RequirePermission(PERMISSION.PROJECT_CHANGE_REVIEW)
  @ApiOperation({ summary: 'Reject a request, with the reason' })
  reject(
    @Param('changeRequestId', ID) changeRequestId: string,
    @Body() dto: ResolveChangeRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.changeRequests.resolve(changeRequestId, false, dto, user);
  }
}
