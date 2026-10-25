import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class AddCreatorRequestDto {
  @ApiProperty({ description: 'Active Content Creator account joining the project.' })
  @IsUUID('4')
  creatorId: string;

  @ApiPropertyOptional({ example: 'Phụ trách mùa 2.' })
  @IsString()
  @MaxLength(1000)
  @IsOptional()
  note?: string;
}

/** Creator 1 hands some of their episodes to Creator 2 (BR-13). */
export class DelegateEpisodesRequestDto {
  @ApiProperty({ description: 'The Creator taking over; joins the project when not on it yet.' })
  @IsUUID('4')
  toCreatorId: string;

  @ApiProperty({ type: [String], description: 'Episodes handed over; each must be yours to hand over.' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  episodeIds: string[];

  @ApiPropertyOptional({ example: 'Nghỉ phép hai tuần.' })
  @IsString()
  @MaxLength(1000)
  @IsOptional()
  note?: string;
}

export class AssignEpisodeRequestDto {
  @ApiPropertyOptional({
    nullable: true,
    description: 'A Creator of the project; null hands the episode back to the whole team.',
  })
  @IsUUID('4')
  @IsOptional()
  creatorId?: string | null;
}
