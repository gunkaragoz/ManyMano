/** Only a response to the currently confirmed form may resume a signup. */
export function matchesSignupAttempt(
  responseAttemptId: string | undefined,
  activeAttemptId: number | null,
  pendingAttemptId: number | null
): boolean {
  return activeAttemptId !== null && pendingAttemptId === activeAttemptId &&
    responseAttemptId === String(activeAttemptId);
}
