import { IsDateString, IsOptional, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePublicationRequestDto {
  @ApiProperty({
    example: 'f9e8d7c6-b5a4-3210-fedc-ba9876543210',
    description: 'Episode package to publish. Must be the current package of the episode.',
  })
  @IsUUID()
  packageId: string;

  @ApiProperty({
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    description: 'UUID of the user that schedules/publishes.',
  })
  @IsUUID()
  publishedById: string;

  @ApiPropertyOptional({
    example: '2026-10-01T08:00:00.000Z',
    description: 'Optional scheduled publish time. Omit to keep the publication pending until /publish is called.',
  })
  @IsDateString()
  @IsOptional()
  scheduledAt?: string;
}
