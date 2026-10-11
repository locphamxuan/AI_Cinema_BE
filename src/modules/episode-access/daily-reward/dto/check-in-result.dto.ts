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

  @ApiProperty({ example: 5, description: 'Bonus Coins credited (check-in pays bonus Coins only)' })
  bonusGranted: number;

  @ApiProperty({ example: false, description: 'The milestone day: one reward spin was granted' })
  spinGranted: boolean;

  @ApiProperty({ example: 137 })
  bonusBalance: number;

  @ApiProperty({ example: 12 })
  mainBalance: number;
}
