// Leaf module (no imports): shared by scoutReview and scoutDismissed.
export function sourceRefFor(scoutRunId: string, proposalId: string): string {
  return `${scoutRunId}#${proposalId}`;
}
