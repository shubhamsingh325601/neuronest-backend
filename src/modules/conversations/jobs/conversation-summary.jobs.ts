import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ConversationStatus,
  MessageState,
  SummaryStatus,
  type Prisma,
} from '@prisma/client';
import { AiRunError, AiService } from '@common/ai/ai.service';
import type { AppConfig } from '@common/config/configuration';
import { JobHandlerRegistry, type JobContext } from '@common/jobs/job-handler.registry';
import { PrismaService } from '@common/prisma/prisma.service';
import { nameTokens } from '@modules/ai-coaching/shared/text-safety.util';
import { conversationSummaryPromptV1 as prompt } from '@modules/conversations/prompts/conversation-summary.v1';
import type { ConversationSummaryContent } from '@modules/conversations/shared/conversation-summary.content';
import {
  buildSummaryRequest,
  SUMMARY_MAX_OUTPUT_TOKENS,
} from '@modules/conversations/shared/conversation-summary.request';
import type { NameGroup } from '@modules/conversations/shared/pii-redaction';
import { SUMMARISE_JOB } from './conversation-summary.queue';

const OPEN_STATES: SummaryStatus[] = [SummaryStatus.PENDING, SummaryStatus.FAILED];

/** A malformed payload is a permanent bug, so throw. */
function payloadConversationId(job: JobContext): string {
  const payload = job.payload;
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const id = payload['conversationId'];
    if (typeof id === 'string' && id.length > 0) return id;
  }
  throw new Error(`Job ${job.id} (${job.type}) has no conversationId in its payload`);
}

/**
 * Writes the summary of a closed conversation (plan 0019 §7). It runs as a system actor: there is no
 * requester, and the conversation row is the authorisation. The model only ever sees name-scrubbed,
 * PII-redacted text. Every AI failure is stored as a stable code on the summary and then rethrown, so
 * the queue retries and, once the attempts are used up, leaves a DEAD job for the admin.
 */
@Injectable()
export class ConversationSummaryJobs implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: JobHandlerRegistry,
    private readonly ai: AiService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  onModuleInit(): void {
    this.registry.register(SUMMARISE_JOB, (job) => this.summarise(job));
  }

  async summarise(job: JobContext): Promise<void> {
    const conversationId = payloadConversationId(job);
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        id: true,
        kind: true,
        childId: true,
        status: true,
        messagesPurgedAt: true,
        child: { select: { name: true } },
        parent: { select: { name: true } },
        expert: { select: { name: true } },
        summary: { select: { status: true } },
      },
    });
    // Gone, still open, already purged (the raw text no longer exists), or already finished: nothing to do.
    if (
      !conversation ||
      conversation.status !== ConversationStatus.CLOSED ||
      conversation.messagesPurgedAt ||
      conversation.summary?.status === SummaryStatus.READY ||
      conversation.summary?.status === SummaryStatus.PLACEHOLDER
    ) {
      return;
    }

    if (!conversation.summary) {
      await this.prisma.conversationSummary.createMany({
        data: [{ conversationId, childId: conversation.childId }],
        skipDuplicates: true,
      });
    }

    const kind = conversation.kind;
    const messages = await this.prisma.message.findMany({
      where: { conversationId, state: MessageState.COMPLETE },
      orderBy: { seq: 'asc' },
      select: { sender: true, body: true },
    });
    if (messages.length === 0) {
      // Nothing was said, so there is nothing to ask the model.
      await this.store(conversationId, {
        overview: 'No messages were exchanged in this conversation.',
        themes: [],
        parentConcerns: [],
        guidanceGiven: [],
        openQuestions: [],
        followUpSuggested: false,
        participantsKind: kind,
      });
      return;
    }

    const clinicians = await this.prisma.clinicianChildAssignment.findMany({
      where: { childId: conversation.childId },
      select: { clinician: { select: { name: true } } },
    });
    const groups: NameGroup[] = [
      { tokens: nameTokens(conversation.child.name), placeholder: 'the child' },
      { tokens: nameTokens(conversation.parent.name), placeholder: 'the parent' },
      ...(conversation.expert
        ? [{ tokens: nameTokens(conversation.expert.name), placeholder: 'the expert' }]
        : []),
      ...clinicians.map(({ clinician }) => ({
        tokens: nameTokens(clinician.name),
        placeholder: 'the clinician',
      })),
    ];

    let result;
    try {
      result = await this.ai.generateStructured(
        buildSummaryRequest({
          kind,
          childId: conversation.childId,
          names: groups,
          messages,
          maxOutputTokens: Math.max(
            SUMMARY_MAX_OUTPUT_TOKENS,
            this.config.get('ai', { infer: true }).maxOutputTokens,
          ),
        }),
      );
    } catch (err) {
      if (err instanceof AiRunError) await this.markFailed(conversationId, err.code);
      // `AiRunError`'s message is derived from its code, so this is safe for `Job.lastError`.
      throw err;
    }

    await this.store(
      conversationId,
      { ...result.output, participantsKind: kind },
      { provider: result.provider, model: result.model, promptVersion: prompt.version },
    );
  }

  /** Only a PENDING or FAILED row is written: a purge that wrote a PLACEHOLDER meanwhile wins. */
  private async store(
    conversationId: string,
    content: ConversationSummaryContent,
    meta: { provider?: string; model?: string; promptVersion?: number } = {},
  ): Promise<void> {
    await this.prisma.conversationSummary.updateMany({
      where: { conversationId, status: { in: OPEN_STATES } },
      data: {
        status: SummaryStatus.READY,
        content: content as unknown as Prisma.InputJsonValue,
        provider: meta.provider ?? null,
        model: meta.model ?? null,
        promptVersion: meta.promptVersion ?? null,
        failureReason: null,
        generatedAt: new Date(),
      },
    });
  }

  private async markFailed(conversationId: string, reason: string): Promise<void> {
    await this.prisma.conversationSummary.updateMany({
      where: { conversationId, status: { in: OPEN_STATES } },
      data: { status: SummaryStatus.FAILED, failureReason: reason },
    });
  }
}
