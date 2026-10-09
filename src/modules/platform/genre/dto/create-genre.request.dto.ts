import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateGenreRequestDto {
  @ApiProperty({ example: 'Hậu tận thế', description: 'Name of the new genre.' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ example: 'Thế giới sau thảm hoạ.', description: 'Overview of what this genre covers.' })
  @IsString()
  @IsOptional()
  description?: string;
}
