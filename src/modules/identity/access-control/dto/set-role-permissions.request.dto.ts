import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsString, MaxLength } from 'class-validator';

export class SetRolePermissionsRequestDto {
  @ApiProperty({
    example: ['studio:handoff', 'media:ingest'],
    description: 'Every permission the role holds from now on.',
  })
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  permissions: string[];
}
