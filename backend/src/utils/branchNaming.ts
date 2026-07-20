/**
 * Session-branch naming convention (Sub-step H.0 extraction).
 *
 * Sub-step H.0 FIX: the formula `auto/${sessionId}` was previously
 * duplicated in two independent places - routes/capture.ts's inline
 * template literal (`target_branch: \`auto/${session_id}\``) and
 * githubBranchService.ts's private buildBranchName() function - with no
 * shared source of truth. This is a Likely-confidence maintainability
 * bug rather than a runtime crash today, since both copies currently
 * agree, but it is a real drift risk (Established observation: any
 * future change to the naming convention in one file silently would not
 * propagate to the other without this extraction; not yet observed to
 * have drifted, hence NOT classified as an active bug in the current
 * snapshot - see analysis notes). Both call sites now import this single
 * function instead of each defining their own copy.
 */
export function buildSessionBranchName(sessionId: string): string {
  return `auto/${sessionId}`;
}
