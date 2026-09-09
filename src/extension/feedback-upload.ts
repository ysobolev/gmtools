import { FEEDBACK_SUBMISSION_URL } from "./feedback-config";

export async function submitFeedbackReport(report: unknown): Promise<void> {
  const body = JSON.stringify(report);
  let response: Response;
  try {
    response = await fetch(FEEDBACK_SUBMISSION_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    credentials: "omit",
    referrerPolicy: "no-referrer",
    signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    throw new Error(timedOut
      ? "Feedback submission timed out. We couldn’t confirm that your report was received."
      : "Couldn’t submit feedback. Check your connection or try again later.", { cause: error });
  }
  if (!response.ok) {
    throw new Error(`Submission failed (HTTP ${response.status}).`);
  }
}
