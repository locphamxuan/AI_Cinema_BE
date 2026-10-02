import { BadRequestException } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LabelType, MediaSourceMethod } from '@prisma/client';
import { plainToInstance, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  Equals,
  IsArray,
  IsBoolean,
  IsDefined,
  IsEnum,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
  ValidateNested,
  validateSync,
} from 'class-validator';

const AI_GENERATED_PARTS = ['image', 'video', 'voice', 'music', 'script', 'subtitle'] as const;

/** BR-41: what the studio declares about its use of AI, typed in by the Creator (§4.1.5). */
export class AiDisclosureDto {
  @ApiProperty({ example: ['Kling', 'ElevenLabs'], description: 'AI tools and models the studio used' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(100, { each: true })
  aiTools: string[];

  @ApiProperty({ enum: AI_GENERATED_PARTS, isArray: true, example: ['video', 'voice'] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsIn(AI_GENERATED_PARTS, { each: true })
  aiGeneratedParts: string[];

  @ApiProperty({ description: 'Whether people edited the AI output by hand' })
  @IsBoolean()
  humanEdited: boolean;

  @ApiProperty({ description: 'The studio commits to no misleading likeness of a real person or event' })
  @Equals(true, { message: 'The studio must commit to no misleading real-person or real-event likeness (BR-41)' })
  noRealPersonLikeness: boolean;

  @ApiProperty({ description: 'The studio commits to using no third-party copyrighted work' })
  @Equals(true, { message: 'The studio must commit to using no copyrighted material (BR-41)' })
  noCopyrightedMaterial: boolean;
}

class MediaMetadataDto {
  @ApiProperty({ enum: LabelType, description: 'AI label the Creator proposes; the Reviewer decides (BR-40)' })
  @IsEnum(LabelType)
  proposedLabelType: LabelType;

  @ApiPropertyOptional({ example: 'Bản sửa theo góp ý: thay nhạc nền ở phút 3.' })
  @IsString()
  @MaxLength(2000)
  @IsOptional()
  submissionNote?: string;
}

/** Steps 5–6 by link: an HLS playlist the studio hosts, or a video file the platform downloads. */
export class SubmitMediaLinkRequestDto extends MediaMetadataDto {
  @ApiProperty({ enum: [MediaSourceMethod.HLS_URL, MediaSourceMethod.REMOTE_FILE] })
  @IsIn([MediaSourceMethod.HLS_URL, MediaSourceMethod.REMOTE_FILE])
  sourceMethod: 'HLS_URL' | 'REMOTE_FILE';

  @ApiProperty({ example: 'https://cdn.studio.example/ep1/master.m3u8' })
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false })
  @MaxLength(1000)
  sourceUrl: string;

  @ApiProperty({ type: AiDisclosureDto })
  @IsDefined({ message: 'aiDisclosure is required (BR-41)' })
  @IsObject()
  @ValidateNested()
  @Type(() => AiDisclosureDto)
  aiDisclosure: AiDisclosureDto;
}

/** Step 5 by file: multipart fields next to `file`; `aiDisclosure` is the JSON of AiDisclosureDto. */
export class SubmitMediaUploadRequestDto extends MediaMetadataDto {
  @ApiProperty({ description: 'JSON of AiDisclosureDto', example: JSON.stringify({ aiTools: ['Kling'] }) })
  @IsString()
  @MaxLength(10_000)
  aiDisclosure: string;
}

/** Parses and validates the disclosure a multipart request carries as JSON. */
export function parseAiDisclosure(json: string): AiDisclosureDto {
  let plain: unknown;
  try {
    plain = JSON.parse(json);
  } catch {
    throw new BadRequestException('aiDisclosure must be valid JSON');
  }
  const disclosure = plainToInstance(AiDisclosureDto, plain);
  const errors = validateSync(disclosure, { whitelist: true, forbidNonWhitelisted: true });
  if (typeof plain !== 'object' || plain === null || errors.length) {
    const messages = errors.flatMap((error) => Object.values(error.constraints ?? {}));
    throw new BadRequestException(messages.length ? messages : ['aiDisclosure must be an object']);
  }
  return disclosure;
}
