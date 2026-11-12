import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class AssignSupportCaseRequestDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  staffId: string;
}
