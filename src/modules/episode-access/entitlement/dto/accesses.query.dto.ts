import { AccessSource } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';

export class AccessesQueryDto {
  @IsEnum(AccessSource)
  @IsOptional()
  source?: AccessSource;
}
