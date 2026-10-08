import { Injectable } from '@nestjs/common';
import type { LanguageModel } from 'ai';

export interface ResolvedModel {
  provider: string;
  modelId: string;
  /** Always a model instance, never a bare string id (a string would route via the Vercel AI Gateway). */
  model: Exclude<LanguageModel, string>;
}

/** Splits a `provider:model` spec. The model id may itself contain further colons. */
export function parseModelSpec(spec: string): { provider: string; modelId: string } {
  const idx = spec.indexOf(':');
  if (idx <= 0 || idx === spec.length - 1) {
    throw new Error(`Invalid AI model spec "${spec}" (expected provider:model)`);
  }
  return { provider: spec.slice(0, idx), modelId: spec.slice(idx + 1) };
}

/**
 * Turns a configured `provider:model` spec into a provider-bound model instance. Provider SDKs
 * are loaded lazily so an unused provider never costs boot time, and each reads its standard
 * key env var (`GOOGLE_GENERATIVE_AI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`), which
 * env validation requires when AI is enabled. Overridable in tests.
 */
@Injectable()
export class AiModelFactory {
  private readonly providers = new Map<string, (modelId: string) => ResolvedModel['model']>();

  async resolve(spec: string): Promise<ResolvedModel> {
    const { provider, modelId } = parseModelSpec(spec);
    let make = this.providers.get(provider);
    if (!make) {
      make = await this.load(provider);
      this.providers.set(provider, make);
    }
    return { provider, modelId, model: make(modelId) };
  }

  private async load(provider: string): Promise<(modelId: string) => ResolvedModel['model']> {
    switch (provider) {
      case 'google': {
        const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
        const p = createGoogleGenerativeAI();
        return (id) => p.languageModel(id);
      }
      case 'anthropic': {
        const { createAnthropic } = await import('@ai-sdk/anthropic');
        const p = createAnthropic();
        return (id) => p.languageModel(id);
      }
      case 'openai': {
        const { createOpenAI } = await import('@ai-sdk/openai');
        const p = createOpenAI();
        return (id) => p.languageModel(id);
      }
      default:
        throw new Error(`Unsupported AI provider "${provider}"`);
    }
  }
}
