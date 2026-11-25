import { describe, expect, it } from 'vitest';
import { externalTaskSchema } from './dto';
const id = 'b2c28382-e7f4-4e48-94e1-fd7095a91733';
const base = { title: '外厂验布', fabricId: id, reviewerId: id, fourPointStandardId: id, templateId: id, factoryName: '外厂一', rolls: [{ rollNo: 'A-001' }] };
describe('外厂自建任务', () => {
  it('接受有效的外厂任务，不允许注入执行人', () => {
    expect(externalTaskSchema.safeParse(base).success).toBe(true);
    expect(externalTaskSchema.safeParse({ ...base, assigneeId: id }).success).toBe(false);
  });
  it('要求审核人、外厂和不重复的卷号', () => {
    expect(externalTaskSchema.safeParse({ ...base, reviewerId: '' }).success).toBe(false);
    expect(externalTaskSchema.safeParse({ ...base, factoryName: '' }).success).toBe(false);
    expect(externalTaskSchema.safeParse({ ...base, rolls: [{ rollNo: 'A' }, { rollNo: ' A ' }] }).success).toBe(false);
  });
});
