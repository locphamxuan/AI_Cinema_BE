import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PERMISSION } from 'src/common/auth/permissions';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { RemoveTempUploadInterceptor } from 'src/common/http/remove-temp-upload.interceptor';
import { ContractService } from 'src/modules/production/contract/contract.service';
import { ContractCostRequestDto } from 'src/modules/production/contract/dto/contract.request.dto';
import {
  parseAiDisclosure,
  SubmitMediaLinkRequestDto,
  SubmitMediaUploadRequestDto,
} from 'src/modules/production/media-ingest/dto/submit-media.request.dto';
import { MediaIngestService } from 'src/modules/production/media-ingest/media-ingest.service';
import { StudioPortalService } from './studio-portal.service';

const ID = new ParseUUIDPipe({ version: '4' });

/**
 * MF-1 (07/11/2026): the API the Studio Web calls once a studio logged in with its STUDIO account — its
 * contracts (fill in the cost, sign, counter-propose), its projects and the films it delivers to the Reviewer.
 */
@ApiTags('studio-portal')
@ApiBearerAuth()
@Controller('studio-portal')
@RequirePermission(PERMISSION.STUDIO_PORTAL)
export class StudioPortalController {
  constructor(
    private readonly portal: StudioPortalService,
    private readonly contracts: ContractService,
    private readonly media: MediaIngestService,
  ) {}

  @Get('me')
  @ApiOperation({ summary: 'The studio this account speaks for' })
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.portal.me(user);
  }

  @Get('contracts')
  @ApiOperation({ summary: 'Every contract round sent to this studio, newest first' })
  async listContracts(@CurrentUser() user: AuthenticatedUser) {
    return this.contracts.forStudio(await this.portal.studioOf(user));
  }

  @Post('contracts/:contractId/propose')
  @HttpCode(200)
  @ApiOperation({ summary: 'Fill in the production cost of a template and sign it' })
  async propose(
    @Param('contractId', ID) contractId: string,
    @Body() dto: ContractCostRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.contracts.propose(contractId, dto.costVnd, await this.portal.studioOf(user));
  }

  @Post('contracts/:contractId/sign')
  @HttpCode(200)
  @ApiOperation({ summary: "Agree with the Admin's cost and sign: the contract is complete, production starts" })
  async sign(@Param('contractId', ID) contractId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.contracts.studioSign(contractId, await this.portal.studioOf(user));
  }

  @Post('contracts/:contractId/counter')
  @HttpCode(200)
  @ApiOperation({ summary: "Disagree with the Admin's cost: propose another one, signed" })
  async counter(
    @Param('contractId', ID) contractId: string,
    @Body() dto: ContractCostRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.contracts.studioCounter(contractId, dto.costVnd, await this.portal.studioOf(user));
  }

  @Get('projects')
  @ApiOperation({ summary: 'Projects this studio was sent a contract for' })
  projects(@CurrentUser() user: AuthenticatedUser) {
    return this.portal.projects(user);
  }

  @Get('projects/:projectId')
  @ApiOperation({ summary: 'A project: Final Script, episodes with deadlines, deliveries and change requests' })
  project(@Param('projectId', ID) projectId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.portal.project(projectId, user);
  }

  @Post('episodes/:episodeId/media')
  @ApiOperation({ summary: 'Send the film of an episode to the Reviewer by link, with the AI Disclosure' })
  submitLink(
    @Param('episodeId', ID) episodeId: string,
    @Body() dto: SubmitMediaLinkRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.media.submitLink(episodeId, dto, user);
  }

  @Post('episodes/:episodeId/media/upload')
  @UseInterceptors(FileInterceptor('file'), RemoveTempUploadInterceptor)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Send the film of an episode to the Reviewer as an MP4/MOV file' })
  submitUpload(
    @Param('episodeId', ID) episodeId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: SubmitMediaUploadRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.media.submitUpload(episodeId, file, dto, parseAiDisclosure(dto.aiDisclosure), user);
  }

  @Post('media-assets/:mediaAssetId/retry')
  @HttpCode(200)
  @ApiOperation({ summary: 'Process a failed delivery again, e.g. once the link is fixed (latest version only)' })
  retry(@Param('mediaAssetId', ID) mediaAssetId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.media.retry(mediaAssetId, user);
  }
}
