import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { HLS_LADDER } from 'src/modules/production/media-ingest/hls/quality-ladder';

/** Most devices one plan may allow, registered or playing at once. */
export const MAX_PLAN_DEVICES = 10;

/**
 * What a plan allows (BR-34), kept in `membership_plans.features`. MF-4 reads the two limits,
 * ad scheduling reads `adFree`, playback reads `maxQuality`; a missing key falls back to the
 * platform default. The service also checks that streams never exceed devices.
 */
export class PlanFeaturesDto {
  @ApiPropertyOptional({
    example: 4,
    minimum: 1,
    maximum: MAX_PLAN_DEVICES,
    description: 'Devices one account may register',
  })
  @IsInt()
  @Min(1)
  @Max(MAX_PLAN_DEVICES)
  @IsOptional()
  maxRegisteredDevices?: number;

  @ApiPropertyOptional({
    example: 2,
    minimum: 1,
    maximum: MAX_PLAN_DEVICES,
    description: 'Devices playing at the same time',
  })
  @IsInt()
  @Min(1)
  @Max(MAX_PLAN_DEVICES)
  @IsOptional()
  maxConcurrentStreams?: number;

  @ApiPropertyOptional({ example: true, description: 'No mid-roll ads' })
  @IsBoolean()
  @IsOptional()
  adFree?: boolean;

  @ApiPropertyOptional({
    enum: HLS_LADDER.map((rung) => rung.name),
    example: '1080p',
    description: 'Highest rendition',
  })
  @IsIn(HLS_LADDER.map((rung) => rung.name))
  @IsOptional()
  maxQuality?: string;
}
