import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** A message between the Creator holding an episode and the lead Creator (BR-67). */
export class SendEpisodeNoteRequestDto {
  @ApiProperty({
    example: 'Tập 2 lệch kịch bản ở phút 1:20, nhờ anh báo Studio sửa cảnh quán cà phê.',
    maxLength: 2000,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  message: string;
}
