import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UnpublishMode, UnpublishReason } from '@prisma/client';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

/** Step 12 (BR-29): the Coin price of one episode; outside the Admin's range it is kept and flagged (BR-47). */
export class SetCoinPriceRequestDto {
  @ApiProperty({ example: 10, minimum: 0 })
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  coinPrice: number;
}

/** Steps 12–14: release now, or at `scheduledAt` (BR-19). */
export class PublishEpisodeRequestDto {
  @ApiPropertyOptional({ example: '2026-11-20T20:00:00+07:00', description: 'Omit to publish at once' })
  @IsDateString({ strict: true })
  @IsOptional()
  scheduledAt?: string;
}

/** Takes a published episode down, or cancels a scheduled release. */
export class UnpublishRequestDto {
  @ApiPropertyOptional({
    enum: UnpublishMode,
    description:
      'Required for a published episode: REVISION = back to the Creator to be fixed, buyers keep access (BR-56); ' +
      'REMOVAL = taken down for good, buyers refunded (BR-52). Ignored when cancelling a schedule.',
  })
  @IsEnum(UnpublishMode)
  @IsOptional()
  mode?: UnpublishMode;

  @ApiProperty({ enum: UnpublishReason })
  @IsEnum(UnpublishReason)
  reason: UnpublishReason;

  @ApiProperty({
    example: 'Studio báo nhạc nền tập này chưa xử lý xong bản quyền.',
    description: 'With REVISION it is the feedback the Creator forwards to the studio',
  })
  @IsString()
  @MinLength(5)
  @MaxLength(2000)
  note: string;
}

/** The Admin asks the Reviewer to change an out-of-range price; the Admin never edits it (BR-47). */
export class RequestPriceChangeRequestDto {
  @ApiProperty({ example: 'Giá 120 Coin cao hơn nhiều so với khoảng 1–50 của nền tảng, nhờ xem lại.' })
  @IsString()
  @MinLength(5)
  @MaxLength(2000)
  note: string;
}
