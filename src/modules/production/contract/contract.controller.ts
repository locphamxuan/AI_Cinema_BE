import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Post,
  UploadedFile,
} from '@nestjs/common';
import { ContractDocumentSide } from '@prisma/client';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PERMISSION } from 'src/common/auth/permissions';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { ContractDocumentService } from './contract-document.service';
import { ContractService } from './contract.service';
import { ContractCostRequestDto, CreateContractRequestDto } from './dto/contract.request.dto';
import { SignedPdfUpload } from './signed-pdf-upload';

const ID = new ParseUUIDPipe({ version: '4' });
const SIDE = new ParseEnumPipe(ContractDocumentSide);

/** MF-1 contract negotiation between the Admin and the project's studio (Admin side; the studio uses /studio-portal). */
@ApiTags('contracts')
@ApiBearerAuth()
@Controller()
export class ContractController {
  constructor(
    private readonly contracts: ContractService,
    private readonly documents: ContractDocumentService,
  ) {}

  @Post('projects/:projectId/contracts')
  @RequirePermission(PERMISSION.CONTRACT_MANAGE)
  @ApiOperation({
    summary: "Admin: send the project's studio its template contract again (normally sent on Final Script)",
  })
  create(
    @Param('projectId', ID) projectId: string,
    @Body() dto: CreateContractRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.contracts.resend(projectId, dto.terms, user);
  }

  @Get('projects/:projectId/contracts')
  @ApiOperation({ summary: 'Every negotiation round of the project with its studio' })
  list(@Param('projectId', ID) projectId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.contracts.list(projectId, user);
  }

  @Post('contracts/:contractId/sign')
  @HttpCode(200)
  @RequirePermission(PERMISSION.CONTRACT_MANAGE)
  @SignedPdfUpload()
  @ApiOperation({
    summary:
      "Admin: agree with the studio's cost by uploading the contract PDF signed by AI Cinema; both signatures complete the contract",
  })
  sign(
    @Param('contractId', ID) contractId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.contracts.sign(contractId, user, file);
  }

  @Post('contracts/:contractId/counter')
  @HttpCode(200)
  @RequirePermission(PERMISSION.CONTRACT_MANAGE)
  @SignedPdfUpload(true)
  @ApiOperation({
    summary: 'Admin: propose a different cost instead, with the contract PDF signed for it, opening a new round',
  })
  counter(
    @Param('contractId', ID) contractId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: ContractCostRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.contracts.counter(contractId, dto.costVnd, user, file);
  }

  @Get('contracts/:contractId/documents')
  @RequirePermission(PERMISSION.CONTRACT_DOCUMENT_READ)
  @ApiOperation({ summary: 'The signed PDFs of a round: the Admin side, the studio side and the merged document' })
  documentsOf(@Param('contractId', ID) contractId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.documents.list(contractId, user);
  }

  @Get('contracts/:contractId/documents/:side/content')
  @RequirePermission(PERMISSION.CONTRACT_DOCUMENT_READ)
  @ApiOperation({ summary: 'Download ADMIN, STUDIO or FINAL — the FINAL one carries both signatures' })
  download(
    @Param('contractId', ID) contractId: string,
    @Param('side', SIDE) side: ContractDocumentSide,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.documents.download(contractId, side, user);
  }
}
