import type { AiStructuredRequest } from '@common/ai/ai.service';
import { coachingTipPromptV3 } from '@modules/ai-coaching/prompts/coaching-tip.v3';
import { COACHING_TIP_CAPABILITY } from './ai-coaching.constants';
import type { BuiltCoachingContext } from './coaching-context.builder';
import { checkCoachingTip } from './coaching-safety.filter';
import { coachingTipSchema, type CoachingTipContent } from './coaching-tip.schema';

/** The prompt version every coaching-tip request is made with. Bump here, and only here. */
export const coachingTipPrompt = coachingTipPromptV3;

/**
 * The one definition of a coaching-tip request. The request path, the background job and the
 * live eval all send exactly this, so an eval result describes what production does.
 */
export function buildCoachingTipRequest(
  built: BuiltCoachingContext,
  actor: AiStructuredRequest<CoachingTipContent>['actor'],
  maxOutputTokens: number,
): AiStructuredRequest<CoachingTipContent> {
  const prompt = coachingTipPrompt;
  const { planDay, clinicianTips } = built.context;
  const stepsRequired = planDay !== null || clinicianTips.length > 0;
  return {
    capability: COACHING_TIP_CAPABILITY,
    prompt: { id: prompt.id, version: prompt.version },
    system: prompt.system,
    user: prompt.buildUser(built.context),
    schema: coachingTipSchema,
    postCheck: (tip) => checkCoachingTip(tip, built.nameTokens, { stepsRequired }),
    actor,
    maxOutputTokens,
  };
}
