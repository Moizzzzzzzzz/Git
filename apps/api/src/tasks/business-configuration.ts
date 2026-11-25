import { standardRulesSchema, templateContentSchema } from '@fabricqc/shared';
import { AppError } from '../common/app-error';

/** Validate only declared scheme scope; missing legacy metadata remains explicitly unspecified. */
export function validateBusinessConfiguration(templateContent: unknown, ruleContents: unknown[]) {
  const template = templateContentSchema.parse(templateContent);
  const standards = ruleContents.map(r => standardRulesSchema.parse(r));
  const keys = new Set(template.checklist.map(c => c.key));
  for (const standard of standards) {
    const missing = (standard.checklistPolicies ?? []).filter(p => !keys.has(p.checklistKey));
    if (missing.length) throw AppError.badRequest(`标准检查项不在检验模板中：${missing.map(p => p.checklistKey).join('、')}`);
  }
  const scopes = [template.applicability, ...standards.map(s => s.applicability)].filter((s): s is NonNullable<typeof s> => Boolean(s));
  for (const dimension of ['structure', 'fiber'] as const) {
    if (scopes.length > 1 && !scopes[0][dimension].some(value => scopes.every(scope => (scope[dimension] as readonly string[]).includes(value)))) throw AppError.badRequest('所选标准和模板的面料适用范围不兼容');
  }
}
