import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LabelType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDefined,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { AiDisclosureDto } from './submit-media.request.dto';

/** Step 1 of a direct upload: what the studio is about to send, checked before any byte moves. */
export class StartDirectUploadRequestDto {
  @ApiProperty({ example: 'tap-1.mp4', description: 'MP4 or MOV' })
  @IsString()
  @MaxLength(255)
  fileName: string;

  @ApiProperty({ example: 734_003_200 })
  @IsInt()
  @Min(1)
  sizeBytes: number;
}

/** Step 3: the file is in the bucket; the studio sends what the multipart route takes next to it. */
export class CompleteDirectUploadRequestDto {
  @ApiProperty({ description: 'The uploadToken step 1 answered' })
  @IsString()
  @MaxLength(2000)
  uploadToken: string;

  @ApiProperty({ enum: LabelType, description: 'AI label the studio proposes; the Reviewer decides (BR-40)' })
  @IsEnum(LabelType)
  proposedLabelType: LabelType;

  @ApiPropertyOptional({ example: 'Bản sửa theo góp ý: thay nhạc nền ở phút 3.' })
  @IsString()
  @MaxLength(2000)
  @IsOptional()
  submissionNote?: string;

  @ApiProperty({ type: AiDisclosureDto })
  @IsDefined({ message: 'aiDisclosure is required (BR-41)' })
  @IsObject()
  @ValidateNested()
  @Type(() => AiDisclosureDto)
  aiDisclosure: AiDisclosureDto;
}
