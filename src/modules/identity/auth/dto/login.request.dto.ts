import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginRequestDto {
  @ApiProperty({ example: 'creator01@aicinema.com', description: 'Email of the account.' })
  @IsEmail()
  @MaxLength(255)
  email: string;

  @ApiProperty({ example: 'Aicinema@123', description: 'Password of the account.' })
  @IsString()
  @MinLength(1)
  @MaxLength(72)
  password: string;
}
