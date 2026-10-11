import { AccessSource } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { PageQueryDto } from 'src/common/validation/page-query.dto';

export class AccessesQueryDto extends PageQueryDto {
  @IsEnum(AccessSource)
  @IsOptional()
  source?: AccessSource;
}
