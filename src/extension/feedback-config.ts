// Public upload destination; no credentials belong in this file.
declare const __GMTOOLS_FEEDBACK_SUBMISSION_URL__: string | undefined;

export const FEEDBACK_SUBMISSION_URL =
  typeof __GMTOOLS_FEEDBACK_SUBMISSION_URL__ === "string"
    ? __GMTOOLS_FEEDBACK_SUBMISSION_URL__
    : "https://gmtools-feedback.yury-sobolev.workers.dev/feedback";
