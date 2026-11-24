import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';

const ID = new ParseUUIDPipe({ version: '4' });
import { PERMISSION } from 'src/common/auth/permissions';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiPaginatedResponse, Paginate, type PaginateQuery } from '@nestarc/pagination';
import { PolicyDto } from './dto/policy.dto';
import { PolicyService } from './policy.service';
import { CreatePolicyDto } from './dto/create-policy.dto';
import { UpdatePolicyDto } from './dto/update-policy.dto';

/** The Reviewer reads the policies; only the Admin writes them. */
@ApiTags('policies')
@ApiBearerAuth()
@RequirePermission(PERMISSION.CONTENT_REVIEW, PERMISSION.PLATFORM_SETTINGS_MANAGE)
@Controller('policies')
export class PolicyController {
  constructor(private readonly policyService: PolicyService) {}

  @Get()
  @ApiPaginatedResponse(PolicyDto)
  async findAll(@Paginate() query: PaginateQuery) {
    return this.policyService.findAll(query);
  }

  @Get('in-force')
  @ApiOperation({ summary: 'Policies switched on and within their dates: what the Reviewer must follow now' })
  @ApiOkResponse({ type: PolicyDto, isArray: true })
  async inForce() {
    return this.policyService.inForce();
  }

  @Post()
  @RequirePermission(PERMISSION.PLATFORM_SETTINGS_MANAGE)
  async create(@Body() dto: CreatePolicyDto) {
    return this.policyService.create(dto);
  }

  @Patch(':id')
  @RequirePermission(PERMISSION.PLATFORM_SETTINGS_MANAGE)
  async update(@Param('id', ID) id: string, @Body() dto: UpdatePolicyDto) {
    return this.policyService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermission(PERMISSION.PLATFORM_SETTINGS_MANAGE)
  async remove(@Param('id', ID) id: string) {
    return this.policyService.remove(id);
  }
}
