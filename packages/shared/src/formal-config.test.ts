import { describe, expect, it } from 'vitest';
import { yongshengFormalConfig } from './formal-config';

describe('formal rule content without publishing', () => {
  it.each(['KNIT', 'WOVEN'] as const)('%s has matching scope and explicit policy', structure => {
    const { rules, template } = yongshengFormalConfig(structure);
    expect(rules.applicability).toEqual(template.applicability);
    expect(rules.fourPoint).toMatchObject({ areaUnit: 'PER_100_LINEAR_YD', continuousAllocation: 'COVERED_CAPACITY_V1', maxPointsPerLinearUnit: { unitLengthM: 0.9144, maxPoints: 4 } });
    expect(rules).toMatchObject({ thresholds: { maxNormalizedPoints: 40 }, failOnSeverity: 'MAJOR', requiredScope: 'FULL', requireDefectPhoto: true });
    expect(template.measurements.find(x => x.key === 'effective_width')).toMatchObject({ required: true, minReadings: 3 });
    expect(template.measurements.some(x => x.key === 'width')).toBe(false);
    expect(template.checklist.find(x => x.key === 'label_match')?.required).toBe(true);
    expect(template.photoCheckpoints.filter(x => x.required)).toHaveLength(0);
    expect(new Set(rules.checklistPolicies?.map(x => x.checklistKey))).toEqual(new Set(template.checklist.map(x => x.key)));
  });
});
