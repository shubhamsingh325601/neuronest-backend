import { AiModelFactory, parseModelSpec } from './ai-model.factory';

describe('parseModelSpec', () => {
  it('splits provider and model id', () => {
    expect(parseModelSpec('google:gemini-3.5-flash-lite')).toEqual({
      provider: 'google',
      modelId: 'gemini-3.5-flash-lite',
    });
  });

  it('keeps further colons in the model id', () => {
    expect(parseModelSpec('openai:ft:gpt-5:org')).toEqual({
      provider: 'openai',
      modelId: 'ft:gpt-5:org',
    });
  });

  it.each(['gemini', ':model', 'google:', ''])('rejects %p', (spec) => {
    expect(() => parseModelSpec(spec)).toThrow(/Invalid AI model spec/);
  });
});

describe('AiModelFactory', () => {
  beforeEach(() => {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'test-key-not-real';
    process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
    process.env.OPENAI_API_KEY = 'test-key-not-real';
  });
  afterEach(() => {
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  it.each([
    ['google:gemini-3.5-flash-lite', 'google'],
    ['anthropic:claude-sonnet-5-5', 'anthropic'],
    ['openai:gpt-5.1', 'openai'],
  ])('resolves %s to a model instance, never a string', async (spec, provider) => {
    const resolved = await new AiModelFactory().resolve(spec);

    expect(resolved.provider).toBe(provider);
    expect(typeof resolved.model).toBe('object');
    expect(resolved.model).toMatchObject({ specificationVersion: expect.any(String) });
  });

  it('reuses the loaded provider across resolves', async () => {
    const factory = new AiModelFactory();
    const a = await factory.resolve('google:gemini-3.5-flash-lite');
    const b = await factory.resolve('google:gemini-3.1-flash-lite');
    expect(a.model).not.toBe(b.model);
  });

  it('rejects an unsupported provider', async () => {
    await expect(new AiModelFactory().resolve('mistral:large')).rejects.toThrow(
      /Unsupported AI provider/,
    );
  });
});
