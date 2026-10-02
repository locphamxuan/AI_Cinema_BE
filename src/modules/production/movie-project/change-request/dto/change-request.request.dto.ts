import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class ProposeChangeRequestDto {
  @ApiProperty({ example: 'Episode 3 is planned for 45 minutes; the audience prefers 15-minute episodes.' })
  @IsString()
  @MinLength(5)
  @MaxLength(5000)
  content: string;

  @ApiPropertyOptional({ description: 'The episode the proposal is about; empty = the whole project.' })
  @IsUUID('4')
  @IsOptional()
  episodeId?: string;
}

export class ResolveChangeRequestDto {
  @ApiPropertyOptional({ description: 'Answer to the Admin; required when rejecting.' })
  @IsString()
  @MaxLength(5000)
  @IsOptional()
  response?: string;
}
