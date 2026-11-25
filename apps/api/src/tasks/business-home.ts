/** Progress prerequisites only; authorization, cooldown and final delivery checks remain server-side. */
export function businessHomeFlags(input: { status: string; delivered: boolean; assigned: boolean; hasSupervisor: boolean; planned: number; statuses: (string | null)[] }) {
  const allApproved = input.planned > 0 && input.statuses.length === input.planned && input.statuses.every((status) => status === 'APPROVED');
  const active = input.status !== 'CANCELLED' && !input.delivered;
  return {
    finalConfirmationReady: active && input.assigned && allApproved,
    canRemind: active && input.hasSupervisor && (input.statuses.includes('SUBMITTED') || allApproved),
  };
}
