import { ApiProperty, ApiPropertyOptional, type ApiBodyOptions } from '@nestjs/swagger';
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

/**
 * The cost (VND) either side fills in or counter-proposes, in whole thousands, sent as multipart/form-data
 * next to the PDF of the contract for that cost carrying the signature of the side sending it.
 */
export class ContractCostRequestDto {
  @ApiProperty({ example: 170_000_000 })
  @IsVnd()
  costVnd: number;
}

/** The multipart body of every signing endpoint: one `file` field holding the signed contract PDF. */
export const SIGNED_PDF_BODY: ApiBodyOptions = {
  schema: {
    type: 'object',
    required: ['file'],
    properties: { file: { type: 'string', format: 'binary', description: 'Signed contract PDF (≤ 10 MB)' } },
  },
};

/** The same, with the cost the sender signed for. */
export const SIGNED_PDF_WITH_COST_BODY: ApiBodyOptions = {
  schema: {
    type: 'object',
    required: ['file', 'costVnd'],
    properties: {
      file: { type: 'string', format: 'binary', description: 'Signed contract PDF (≤ 10 MB)' },
      costVnd: { type: 'integer', example: 170_000_000, description: 'Production cost in whole thousands of VND' },
    },
  },
};
