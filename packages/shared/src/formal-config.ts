import { DEV_DEFAULT_FOUR_POINT_RULES, standardRulesSchema } from './rules';
import { templateContentSchema } from './inspection';

/** Approved factory rule content only; does not publish or insert anything. */
export function yongshengFormalConfig(structure: 'KNIT' | 'WOVEN') {
  const scope = { structure: [structure], fiber: ['POLYESTER', 'NYLON'] };
  const surface = structure === 'KNIT' ? 'knit_surface' : 'woven_surface';
  const rules = standardRulesSchema.parse({
    ...DEV_DEFAULT_FOUR_POINT_RULES,
    formalProfile: 'YONGSHENG_2026', applicability: scope,
    fourPoint: { ...DEV_DEFAULT_FOUR_POINT_RULES.fourPoint, areaUnit: 'PER_100_LINEAR_YD', continuousAllocation: 'COVERED_CAPACITY_V1' },
    thresholds: { maxNormalizedPoints: 40 }, failOnSeverity: 'MAJOR', requiredScope: 'FULL', requireDefectPhoto: true,
    checklistPolicies: [
      { checklistKey: 'label_match', onNg: 'RECORD_ONLY', onNa: 'ALLOW', onMissing: 'ALLOW' },
      { checklistKey: 'color_match', onNg: 'REVIEW_ON_NG', onNa: 'INCONCLUSIVE', onMissing: 'INCONCLUSIVE' },
      { checklistKey: surface, onNg: 'REVIEW_ON_NG', onNa: 'INCONCLUSIVE', onMissing: 'INCONCLUSIVE' },
      { checklistKey: 'edge_quality', onNg: 'REVIEW_ON_NG', onNa: 'ALLOW', onMissing: 'INCONCLUSIVE' },
      { checklistKey: 'hand_feel', onNg: 'RECORD_ONLY', onNa: 'ALLOW', onMissing: 'ALLOW' },
    ],
    measurementLimits: [{ itemKey: 'effective_width', label: '有效门幅', mode: 'RELATIVE_TO_SPEC', specField: 'cuttableWidthCm', minPct: -5, maxPct: 5, aggregate: 'EACH', required: true, onMissingSpec: 'RECORD_ONLY' }],
  });
  const template = templateContentSchema.parse({ applicability: scope, checklist: [
    { key: 'label_match', label: '卷标核对', required: true },
    { key: 'color_match', label: '对色', required: false },
    { key: surface, label: structure === 'KNIT' ? '针织布面' : '梭织布面', required: false },
    { key: 'edge_quality', label: '布边', required: false },
    { key: 'hand_feel', label: '手感', required: false },
  ], measurements: [
    { key: 'effective_width', label: '有效门幅', unit: 'cm', required: true, minReadings: 3, specField: 'cuttableWidthCm' },
    { key: 'gsm', label: '克重', unit: 'g/m²', required: true, minReadings: 1 },
    { key: 'roll_length', label: '卷长', unit: 'm', required: true, minReadings: 1 },
    { key: 'skew_pct', label: '纬斜/歪斜', unit: '%', required: false, minReadings: 1 },
  ], photoCheckpoints: [] });
  return { rules, template };
}
