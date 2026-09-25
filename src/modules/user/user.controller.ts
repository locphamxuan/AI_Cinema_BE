import { Body, Controller, Get, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ApiPaginatedResponse, Paginate, type PaginateQuery } from '@nestarc/pagination';
import type { AuthenticatedUser } from 'src/common/auth/authenticated-user';
import { PERMISSION } from 'src/common/auth/permissions';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { RequirePermission } from 'src/common/decorators/require-permission.decorator';
import { UserDto } from './dto/user.dto';
import { UpdateUserRequestDto } from './dto/update-user.request.dto';
import { UserService } from './user.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get()
  @RequirePermission(PERMISSION.USER_READ, PERMISSION.MEMBER_OPS_READ)
  @ApiPaginatedResponse(UserDto, {
    filterableColumns: {
      role: ['$eq', '$in'],
      isActive: ['$eq'],
    },
  })
  async findAll(@Paginate() query: PaginateQuery, @CurrentUser() user: AuthenticatedUser) {
    return this.userService.findAll(query, user);
  }

  @Patch(':userId')
  @RequirePermission(PERMISSION.USER_MANAGE)
  async update(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateUserRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.userService.update(userId, dto, user);
  }
}
