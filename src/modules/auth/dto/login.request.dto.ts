import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginRequestDto {
  @ApiProperty({ example: 'creator01@aicinema.com', description: 'Email of the account.' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Aicinema@123', description: 'Plain-text password of the account.' })
  @IsString()
  @MinLength(6)
  password: string;
}
