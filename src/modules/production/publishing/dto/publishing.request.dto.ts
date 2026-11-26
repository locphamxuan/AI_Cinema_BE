import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UnpublishMode, UnpublishReason } from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Trim } from 'src/common/validation/trim';

/** A moment with its time zone: "2026-11-20T20:00:00+07:00" or "…Z"; a bare date or local time is ambiguous. */
const INSTANT_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

/** Step 12 (BR-29): the Coin price of one episode; outside the Admin's range it is kept and flagged (BR-47). */
export class SetCoinPriceRequestDto {
  @ApiProperty({ example: 10, minimum: 0 })
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  coinPrice: number;
}

/** BR-03/BR-19: which episodes the Admin opens before publishing; Guest-free implies Member-free. */
export class SetAccessFlagsRequestDto {
  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  isFreeForGuest?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  isFreeForMember?: boolean;
}

/** Steps 12–14: release now, or at `scheduledAt` (BR-19). */
export class PublishEpisodeRequestDto {
  @ApiPropertyOptional({ example: '2026-11-20T20:00:00+07:00', description: 'Omit to publish at once' })
  @IsDateString({ strict: true })
  @Matches(INSTANT_WITH_ZONE, {
    message: 'scheduledAt must be a date and time with its UTC offset, e.g. …T20:00:00+07:00',
  })
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
  @Trim()
  @IsString()
  @MinLength(5)
  @MaxLength(2000)
  note: string;
}

/** The Admin asks the Reviewer to change an out-of-range price; the Admin never edits it (BR-47). */
export class RequestPriceChangeRequestDto {
  @ApiProperty({ example: 'Giá 120 Coin cao hơn nhiều so với khoảng 1–50 của nền tảng, nhờ xem lại.' })
  @Trim()
  @IsString()
  @MinLength(5)
  @MaxLength(2000)
  note: string;
}
