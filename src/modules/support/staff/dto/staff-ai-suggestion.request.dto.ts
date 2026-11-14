import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class StaffAiSuggestionRequestDto {
  @ApiPropertyOptional({
    example: 'Thành viên hỏi vì sao bị trừ 10 Coin hôm qua, kiểm tra giúp.',
    description: "Staff's own question; omit to draft a reply to the member's last message",
  })
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  question?: string;
}
