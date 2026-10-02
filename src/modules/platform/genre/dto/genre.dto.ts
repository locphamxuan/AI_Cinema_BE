import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GenreDto {
  @ApiProperty({
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    description: 'UUID of the genre.',
  })
  id: string;

  @ApiProperty({
    example: 'Action',
    description: 'Name of the genre.',
  })
  name: string;

  @ApiPropertyOptional({
    example: 'Movies characterized by physical stunts, fights, and intense action sequences.',
    description: 'Overview of what this genre covers.',
  })
  description?: string;
}
