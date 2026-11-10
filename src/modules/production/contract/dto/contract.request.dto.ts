import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Trim } from 'src/common/validation/trim';
import { IsVnd } from 'src/modules/production/production-cost/dto/vnd';

/** Admin: open the negotiation of a hand-off with a template contract (no cost yet). */
export class CreateContractRequestDto {
  @ApiPropertyOptional({ description: 'Working terms shown to the studio; a standard clause is used when left out.' })
  @Trim()
  @IsString()
  @MaxLength(5000)
  @IsOptional()
  terms?: string;
}

/** The cost (VND) either side fills in or counter-proposes, in whole thousands. */
export class ContractCostRequestDto {
  @ApiProperty({ example: 170_000_000 })
  @IsVnd()
  costVnd: number;
}
