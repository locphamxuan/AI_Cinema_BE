import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsISO8601, IsOptional, Max, Min } from 'class-validator';

/** GET /support/conversations/:id/messages: a malformed cursor or size answers 400, never reaches the database. */
export class ListSupportMessagesQueryDto {
  @ApiPropertyOptional({ description: 'ISO time of the oldest message already shown (`nextBefore`)' })
  @IsOptional()
  @IsISO8601({ strict: true })
  before?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
