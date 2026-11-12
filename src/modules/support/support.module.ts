import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from 'src/config/app-config';
import { HashingEmbeddingClient } from 'src/infrastructure/ai/hashing-embedding.client';
import { CHAT_CLIENT, EMBEDDING_CLIENT, type ChatClient } from 'src/infrastructure/ai/llm-client';
import { OpenAiCompatibleChatClient } from 'src/infrastructure/ai/openai-compatible-chat.client';
import { OpenAiCompatibleEmbeddingClient } from 'src/infrastructure/ai/openai-compatible-embedding.client';
import { AccessDecisionModule } from 'src/modules/episode-access/access-decision/access-decision.module';
import { MembershipPlanModule } from 'src/modules/episode-access/membership-plan/membership-plan.module';
import { CatalogModule } from 'src/modules/catalog/catalog.module';
import { PlatformSettingModule } from 'src/modules/platform/platform-setting/platform-setting.module';
import { SupportAgentService } from './ai/support-agent.service';
import { GuardrailsService } from './ai/guardrails';
import { IntentRouterService } from './ai/intent-router';
import { PromptBuilderService } from './ai/prompt-builder';
import { SummaryService } from './ai/summary.service';
import { HandoffSummaryAiService } from './ai/handoff-summary-ai.service';
import { SupportTools } from './ai/tools/support-tools.service';
import { EscalationService } from './chat/escalation.service';
import { MemberSupportController } from './chat/member-support.controller';
import { ResolutionService } from './chat/resolution.service';
import { SupportAiTurnService } from './chat/support-ai-turn.service';
import { SupportChatService } from './chat/support-chat.service';
import { SupportConversationService } from './chat/support-conversation.service';
import { SupportMessageService } from './chat/support-message.service';
import { SupportTurnLockService } from './chat/support-turn-lock.service';
import { ChunkingService } from './knowledge/chunking.service';
import { KnowledgeController, SupportAiHealthController } from './knowledge/knowledge.controller';
import { KnowledgeIndexJob } from './knowledge/knowledge-index.job';
import { KnowledgeService } from './knowledge/knowledge.service';
import { SupportAiHealthService } from './knowledge/support-ai-health.service';
import { RetrievalService } from './knowledge/retrieval.service';
import { SupportRecipientsService } from './staff/support-recipients.service';
import { MemberContextService } from './staff/member-context.service';
import { StaffSupportController } from './staff/staff-support.controller';
import { StaffAiAssistService } from './staff/staff-ai-assist.service';
import { StaffSupportService } from './staff/staff-support.service';
import { SupportStatsService } from './staff/support-stats.service';
import { SupportAutoCloseSweep } from './support-auto-close.sweep';

@Module({
  imports: [PlatformSettingModule, AccessDecisionModule, MembershipPlanModule, CatalogModule],
  controllers: [MemberSupportController, StaffSupportController, KnowledgeController, SupportAiHealthController],
  providers: [
    // AI providers
    {
      provide: CHAT_CLIENT,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): ChatClient | null => {
        // mock mode answers inside SupportAgentService; disabled runs as a human inbox.
        if (config.support.aiMode !== 'live') return null;
        if (!config.support.aiChatBaseUrl || !config.support.aiChatApiKey) return null;
        return new OpenAiCompatibleChatClient({
          baseUrl: config.support.aiChatBaseUrl,
          apiKey: config.support.aiChatApiKey,
          model: config.support.aiChatModel,
          timeoutMs: config.support.aiTimeoutMs,
          temperature: config.support.aiTemperature,
          maxOutputTokens: config.support.aiMaxOutputTokens,
        });
      },
    },
    {
      provide: EMBEDDING_CLIENT,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => {
        if (config.support.aiMode === 'disabled') return null;
        if (config.support.aiMode === 'mock') return new HashingEmbeddingClient(config.support.aiEmbeddingDimensions);
        const baseUrl = config.support.aiEmbeddingBaseUrl ?? config.support.aiChatBaseUrl;
        const apiKey = config.support.aiEmbeddingApiKey ?? config.support.aiChatApiKey;
        // Missing credentials leave the client null: indexing reports FAILED and retrieval falls
        // back to keyword search instead of the boot failing.
        if (!baseUrl || !apiKey) return null;
        return new OpenAiCompatibleEmbeddingClient({
          baseUrl,
          apiKey,
          model: config.support.aiEmbeddingModel,
          dimensions: config.support.aiEmbeddingDimensions,
          timeoutMs: config.support.aiTimeoutMs,
        });
      },
    },
    SupportAgentService,
    PromptBuilderService,
    IntentRouterService,
    GuardrailsService,
    SummaryService,
    HandoffSummaryAiService,
    SupportTools,
    // Conversation core
    SupportChatService,
    SupportAiTurnService,
    SupportConversationService,
    SupportMessageService,
    SupportTurnLockService,
    EscalationService,
    ResolutionService,
    // Staff side
    StaffSupportService,
    StaffAiAssistService,
    SupportStatsService,
    MemberContextService,
    SupportRecipientsService,
    // Knowledge / RAG
    KnowledgeService,
    SupportAiHealthService,
    ChunkingService,
    RetrievalService,
    KnowledgeIndexJob,
    SupportAutoCloseSweep,
  ],
  exports: [SupportChatService, SupportConversationService, SupportMessageService, KnowledgeService],
})
export class SupportModule {}
