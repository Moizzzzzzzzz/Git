/** 每个状态代表同一任务卷的当前有效检验；没有有效检验传 null。 */
export function businessProgress(planned: number, current: Array<'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'RETURNED' | null>) {
  if (!Number.isSafeInteger(planned) || planned <= 0 || current.length > planned) throw new Error('计划卷数与登记卷数不一致');
  const pendingReview = current.filter((s) => s === 'SUBMITTED').length;
  const reviewed = current.filter((s) => s === 'APPROVED' || s === 'REJECTED').length;
  const inspected = pendingReview + reviewed;
  return { planned, registered: current.length, inspected, uninspected: planned - inspected, pendingReview, reviewed, returned: current.filter((s) => s === 'RETURNED').length };
}
