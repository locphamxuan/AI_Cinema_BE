import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Equals, IsIn, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';

export const STUDIO_DECISION = { ACCEPT: 'ACCEPT', DECLINE: 'DECLINE' } as const;
export type StudioDecision = (typeof STUDIO_DECISION)[keyof typeof STUDIO_DECISION];

/** The studio's answer to the hand-off, once. */
export class RespondToHandoffRequestDto {
  @ApiProperty({ enum: Object.values(STUDIO_DECISION) })
  @IsIn(Object.values(STUDIO_DECISION))
  decision: StudioDecision;

  @ApiPropertyOptional({
    description: 'Accepting means agreeing to the brief, the due dates and the AI Cinema delivery terms.',
  })
  @ValidateIf((dto: RespondToHandoffRequestDto) => dto.decision === STUDIO_DECISION.ACCEPT)
  @Equals(true, { message: 'Accept the brief, the due dates and the delivery terms to take the project' })
  acceptTerms?: boolean;

  @ApiPropertyOptional({ example: 'Lịch studio đã kín tới tháng 12.' })
  @ValidateIf((dto: RespondToHandoffRequestDto) => dto.decision === STUDIO_DECISION.DECLINE)
  @IsString()
  @MinLength(5)
  @MaxLength(2000)
  @IsOptional()
  reason?: string;
}
