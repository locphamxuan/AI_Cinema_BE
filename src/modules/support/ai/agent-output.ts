import { SupportEscalationReason } from '@prisma/client';
import { SUPPORT_QUICK_REPLY, type SupportQuickReply } from '../shared/support-status';
import { SUPPORT_TOOL_DEFINITIONS, type SupportToolName } from './tools/tool-definitions';

export type SupportAgentResolution = 'ANSWERED' | 'RESOLVED_SUGGESTED' | 'NEEDS_HUMAN' | 'UNCERTAIN';

/** The validated object the model must produce through the `final_answer` tool. */
export interface AgentOutput {
  reply: string;
  resolution: SupportAgentResolution;
  escalationReason?: SupportEscalationReason;
  confidence: number;
  handoffSummary?: string;
  quickReplies: SupportQuickReply[];
}

const RESOLUTION_SET = new Set<string>(['ANSWERED', 'RESOLVED_SUGGESTED', 'NEEDS_HUMAN', 'UNCERTAIN']);
const ESCALATION_REASON_SET = new Set<string>(Object.values(SupportEscalationReason));
const QUICK_REPLY_SET = new Set<string>(Object.values(SUPPORT_QUICK_REPLY));
const SUPPORT_TOOL_NAMES = new Set<string>(SUPPORT_TOOL_DEFINITIONS.map((tool) => tool.name));

export function isSupportToolName(name: string): name is SupportToolName {
  return SUPPORT_TOOL_NAMES.has(name);
}

export function parseToolArguments(raw: string): Record<string, unknown> {
  const value = parseJson(raw);
  return isRecord(value) ? value : {};
}

export function parseAgentOutput(raw: string): AgentOutput | null {
  const value = parseJson(raw);
  if (!isRecord(value)) return null;

  const reply = typeof value.reply === 'string' ? value.reply.trim() : '';
  if (!reply) return null;

  const resolution =
    typeof value.resolution === 'string' && RESOLUTION_SET.has(value.resolution)
      ? (value.resolution as SupportAgentResolution)
      : null;
  if (!resolution) return null;

  const confidence = parseConfidence(value.confidence);
  if (confidence === null) return null;

  const escalationReason =
    typeof value.escalationReason === 'string' && ESCALATION_REASON_SET.has(value.escalationReason)
      ? (value.escalationReason as SupportEscalationReason)
      : undefined;
  const handoffSummary =
    typeof value.handoffSummary === 'string' && value.handoffSummary.trim() ? value.handoffSummary.trim() : undefined;
  const quickReplies = Array.isArray(value.quickReplies)
    ? value.quickReplies.filter(
        (item): item is SupportQuickReply => typeof item === 'string' && QUICK_REPLY_SET.has(item),
      )
    : [];

  return { reply, resolution, escalationReason, confidence, handoffSummary, quickReplies };
}

function parseConfidence(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return null;
  return parsed;
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
