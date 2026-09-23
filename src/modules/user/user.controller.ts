import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ApiPaginatedResponse, Paginate, type PaginateQuery } from '@nestarc/pagination';
import { UserDto } from './dto/user.dto';
import { UserService } from './user.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get()
  @ApiPaginatedResponse(UserDto, {
    filterableColumns: {
      role: ['$eq', '$in'],
      isActive: ['$eq'],
    },
  })
  async findAll(@Paginate() query: PaginateQuery) {
    return this.userService.findAll(query);
  }
}
