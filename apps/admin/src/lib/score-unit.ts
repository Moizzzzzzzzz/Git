/** Use the frozen evaluation unit; never infer from the current factory standard. */
export function scoreUnitLabel(unit: string | null | undefined): string {
  if (!unit) return '计分单位未记录';
  return ({ PER_100_SQ_YD: '分/100平方码', PER_100_SQ_M: '分/100平方米', PER_100_LINEAR_YD: '分/100码（布长）' } as Record<string, string>)[unit] ?? '未知计分单位';
}

/** Mixed customer/factory scoring must retain the area calculation explanation. */
export function usesOnlyLinearScoring(units: readonly (string | null | undefined)[]): boolean {
  return units.length > 0 && units.every(unit => unit === 'PER_100_LINEAR_YD');
}
