import { ApiProperty } from '@nestjs/swagger';

export class CheckInResultDto {
  @ApiProperty({
    example: '2026-10-05',
    description: 'Business day in Vietnam the reward belongs to',
  })
  checkInDate: Date;

  @ApiProperty({ example: 3 })
  streakDay: number;

  @ApiProperty({ example: true })
  streakContinued: boolean;

  @ApiProperty({ example: 3 })
  coinsGranted: number;

  @ApiProperty({ example: 0 })
  bonusGranted: number;

  @ApiProperty({ example: 137 })
  bonusBalance: number;

  @ApiProperty({ example: 12 })
  mainBalance: number;
}
