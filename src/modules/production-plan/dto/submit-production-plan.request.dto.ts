import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsString, IsNotEmpty, IsInt, Min, IsNumber, IsArray, ArrayMinSize, ValidateNested } from 'class-validator';
import { SubmitProductionPlanSceneDto } from 'src/modules/production-plan/dto/submit-production-plan-scene.request.dto';

export class SubmitProductionPlanRequestDto {
  @ApiProperty({
    example: 'Một chàng trai trở về quê sau nhiều năm...',
  })
  @IsString()
  @IsNotEmpty()
  scriptText: string;

  @ApiProperty({
    example: 'Sử dụng AI video generation theo phong cách cinematic...',
  })
  @IsString()
  @IsNotEmpty()
  productionApproach: string;

  @ApiProperty({
    example: 3000,
  })
  @IsInt()
  @Min(1)
  targetDurationSeconds: number;

  @ApiProperty({
    example: 15000,
  })
  @IsNumber()
  @Min(0)
  estimatedAiResourceUsage: number;

  @ApiProperty({
    type: [SubmitProductionPlanSceneDto],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SubmitProductionPlanSceneDto)
  scenes: SubmitProductionPlanSceneDto[];
}
