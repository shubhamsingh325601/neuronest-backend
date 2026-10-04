import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateChildDto } from './create-child.dto';

const errorsFor = (dateOfBirth: string) =>
  validate(plainToInstance(CreateChildDto, { name: 'Alex', dateOfBirth }));

const day = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

describe('CreateChildDto.dateOfBirth (B-9)', () => {
  it('accepts a past date and today', async () => {
    expect(await errorsFor('2019-05-14')).toHaveLength(0);
    expect(await errorsFor(day(0))).toHaveLength(0);
  });

  it('rejects a future date (today + 2 days is outside any timezone allowance)', async () => {
    expect(await errorsFor(day(2))).toHaveLength(1);
  });

  it('rejects a datetime', async () => {
    expect(await errorsFor('2019-05-14T00:00:00.000Z')).toHaveLength(1);
  });
});
