import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString } from 'class-validator';

export class SetRolePermissionsRequestDto {
  @ApiProperty({
    example: ['production:read', 'production:plan.write'],
    description: 'Every permission the role holds from now on.',
  })
  @IsArray()
  @IsString({ each: true })
  permissions: string[];
}
