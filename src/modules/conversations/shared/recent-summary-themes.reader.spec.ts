import { RecentSummaryThemesReader } from './recent-summary-themes.reader';

function make(rows: { content: unknown }[]) {
  const prisma = { conversationSummary: { findMany: jest.fn().mockResolvedValue(rows) } };
  return { reader: new RecentSummaryThemesReader(prisma as never), prisma };
}

describe('RecentSummaryThemesReader', () => {
  it('reads the latest three READY summaries of the child, newest first', async () => {
    const { reader, prisma } = make([]);

    await reader.read('child-1');

    expect(prisma.conversationSummary.findMany).toHaveBeenCalledWith({
      where: { childId: 'child-1', status: 'READY' },
      orderBy: { generatedAt: 'desc' },
      take: 3,
      select: { content: true },
    });
  });

  it('returns taxonomy themes de-duplicated, and drops anything else', async () => {
    const { reader } = make([
      { content: { themes: ['sleep', 'not-a-theme', 'routines', 42] } },
      { content: { themes: ['sleep', 'sensory'] } },
      { content: null },
      { content: { themes: 'sleep' } },
    ]);

    await expect(reader.read('child-1')).resolves.toEqual({
      themes: ['sleep', 'routines', 'sensory'],
      followUpSuggested: false,
    });
  });

  it('flags a follow-up when any recent summary suggests one, and only for a real true', async () => {
    const some = make([
      { content: { themes: [], followUpSuggested: false } },
      { content: { themes: [], followUpSuggested: true } },
    ]);
    const stringTrue = make([{ content: { themes: [], followUpSuggested: 'true' } }]);

    await expect(some.reader.read('c')).resolves.toMatchObject({ followUpSuggested: true });
    await expect(stringTrue.reader.read('c')).resolves.toMatchObject({ followUpSuggested: false });
  });

  it('never returns free text from a summary', async () => {
    const { reader } = make([
      {
        content: {
          overview: 'Asha could not sleep',
          parentConcerns: ['bedtime'],
          guidanceGiven: ['dim lights'],
          openQuestions: ['why?'],
          themes: ['sleep'],
          followUpSuggested: true,
        },
      },
    ]);

    const result = await reader.read('child-1');

    expect(Object.keys(result).sort()).toEqual(['followUpSuggested', 'themes']);
    expect(JSON.stringify(result)).not.toMatch(/Asha|bedtime|dim lights|why/);
  });
});
