/** Use the frozen evaluation unit; never infer from the current factory standard. */
export function scoreUnitLabel(unit: string | null | undefined): string {
  if (!unit) return '计分单位未记录';
  // Summary endpoints return localized units; detailed frozen evaluations use enums.
  switch (unit) {
    case 'PER_100_SQ_YD': case '分/100平方码': return '分/100平方码';
    case 'PER_100_SQ_M': case '分/100平方米': return '分/100平方米';
    case 'PER_100_LINEAR_YD': case '分/100线码': return '分/100码（布长）';
    default: return '未知计分单位';
  }
}

/** Mixed customer/factory scoring must retain the area calculation explanation. */
export function usesOnlyLinearScoring(units: readonly (string | null | undefined)[]): boolean {
  return units.length > 0 && units.every(unit => unit === 'PER_100_LINEAR_YD');
}
