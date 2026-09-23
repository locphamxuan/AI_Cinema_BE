import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ComplianceResult } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DecideComplianceCheckRequestDto {
  @ApiProperty({ example: 'PASS', description: 'Manual verdict for the compliance check.', enum: ComplianceResult })
  @IsEnum(ComplianceResult)
  result: ComplianceResult;

  @ApiPropertyOptional({ example: 'Nội dung phù hợp chính sách.', description: 'Reason when the check fails.' })
  @IsString()
  @IsOptional()
  failureReason?: string;
}
