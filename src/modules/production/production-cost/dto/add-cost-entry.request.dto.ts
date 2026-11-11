import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProductionCostEntryType } from '@prisma/client';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Trim } from 'src/common/validation/trim';
import { IsVnd, MAX_VND } from './vnd';

/** The entries the Admin writes by hand; ADDITIONAL only comes from an approved cost request. */
export const ADMIN_COST_ENTRY_TYPES = [ProductionCostEntryType.BUDGET, ProductionCostEntryType.CORRECTION] as const;

export class AddCostEntryRequestDto {
  @ApiProperty({ enum: ADMIN_COST_ENTRY_TYPES, example: ProductionCostEntryType.BUDGET })
  @IsIn(ADMIN_COST_ENTRY_TYPES)
  entryType: (typeof ADMIN_COST_ENTRY_TYPES)[number];

  @ApiProperty({
    example: 150_000_000,
    description: 'VND in whole thousands. BUDGET is positive; a CORRECTION may be negative.',
  })
  @IsVnd(-MAX_VND)
  amountVnd: number;

  @ApiPropertyOptional({ example: 'Studio quote came in lower than planned.', description: 'Required for CORRECTION.' })
  @Trim()
  @IsString()
  @MaxLength(2000)
  @IsOptional()
  reason?: string;
}
