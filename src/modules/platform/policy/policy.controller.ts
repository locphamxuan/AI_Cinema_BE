import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { PERMISSION } from 'src/common/auth/permissions';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ApiPaginatedResponse, Paginate, type PaginateQuery } from '@nestarc/pagination';
import { PolicyDto } from './dto/policy.dto';
import { PolicyService } from './policy.service';
import { CreatePolicyDto } from './dto/create-policy.dto';
import { UpdatePolicyDto } from './dto/update-policy.dto';

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

  @Post()
  @ApiTags('policies')
  async create(@Body() dto: CreatePolicyDto) {
    return this.policyService.create(dto);
  }

  @Patch(':id')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePolicyDto) {
    return this.policyService.update(id, dto);
  }

  @Delete(':id')
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.policyService.remove(id);
  }
}
