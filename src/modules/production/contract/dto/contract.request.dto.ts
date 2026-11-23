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
 * next to the signature image of the side signing the contract for that cost.
 */
export class ContractCostRequestDto {
  @ApiProperty({ example: 170_000_000 })
  @IsVnd()
  costVnd: number;
}

/**
 * The studio signing the contract it received: without a cost it signs at the value printed on it, the budget
 * ceiling; with one it proposes a lower cost, which the copy it signs then prints.
 */
export class ProposeContractRequestDto {
  @ApiPropertyOptional({ example: 170_000_000, description: 'Left out: sign at the budget ceiling' })
  @IsVnd()
  @IsOptional()
  costVnd?: number;
}

const SIGNATURE_FILE = {
  type: 'string',
  format: 'binary',
  description: 'Signature image, PNG or JPEG (≤ 2 MB, at least 150x50 px, at most 4000 px a side)',
};

/** The multipart body of every signing endpoint: one `file` field holding the signer's signature image. */
export const SIGNATURE_BODY: ApiBodyOptions = {
  schema: { type: 'object', required: ['file'], properties: { file: SIGNATURE_FILE } },
};

const COST_FIELDS = {
  file: SIGNATURE_FILE,
  costVnd: { type: 'integer', example: 170_000_000, description: 'Production cost in whole thousands of VND' },
};

/** The same, with the cost the sender signs for. */
export const SIGNATURE_WITH_COST_BODY: ApiBodyOptions = {
  schema: { type: 'object', required: ['file', 'costVnd'], properties: COST_FIELDS },
};

/** The same, where the cost may be left out to sign at the budget ceiling. */
export const SIGNATURE_OPTIONAL_COST_BODY: ApiBodyOptions = {
  schema: { type: 'object', required: ['file'], properties: COST_FIELDS },
};
