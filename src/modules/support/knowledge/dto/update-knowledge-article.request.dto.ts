import { PartialType } from '@nestjs/swagger';
import { CreateKnowledgeArticleRequestDto } from 'src/modules/support/knowledge/dto/create-knowledge-article.request.dto';

export class UpdateKnowledgeArticleRequestDto extends PartialType(CreateKnowledgeArticleRequestDto) {}
