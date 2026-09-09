import { useEffect, useRef, useState } from "react";
import { EXTENSION_BROWSER_NAME, EXTENSION_BUILD_ID, EXTENSION_VERSION } from "../build-info";
import { createFeedbackReport, downloadFeedbackReport } from "./feedback-report";
import { submitFeedbackReport } from "./feedback-upload";

export interface FeedbackTarget {
  readonly chatId: string;
  readonly title: string;
  readonly campaignName: string;
  readonly visibleError?: string | undefined;
  readonly runningWhenOpened: boolean;
}

export function FeedbackDialog({ target, onClose, onExported, onSubmitted }: {
  readonly target: FeedbackTarget;
  readonly onClose: () => void;
  readonly onExported: () => void;
  readonly onSubmitted: () => void;
}): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [feedback, setFeedback] = useState("");
  const [email, setEmail] = useState("");
  const [includeChat, setIncludeChat] = useState(true);
  const [includeImages, setIncludeImages] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const busy = exporting || submitting;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  async function finishReport(submit: boolean): Promise<void> {
    if (busy) return;
    if (submit) setSubmitting(true);
    else setExporting(true);
    setError(null);
    try {
      const report = await createFeedbackReport({
        ...target, feedback, email, includeChat, includeImages,
        extension: { version: EXTENSION_VERSION, buildId: EXTENSION_BUILD_ID, browser: EXTENSION_BROWSER_NAME },
      });
      if (submit) await submitFeedbackReport(report);
      else downloadFeedbackReport(report);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not prepare feedback.";
      setError(message);
      return;
    } finally {
      setExporting(false);
      setSubmitting(false);
    }
    if (submit) onSubmitted();
    else onExported();
  }

  return (
    <dialog
      aria-labelledby="feedback-heading"
      className="feedback-dialog"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      ref={dialogRef}
    >
      <form onSubmit={(event) => { event.preventDefault(); void finishReport(true); }}>
        <h2 id="feedback-heading">Feedback</h2>
        <p className="feedback-description">Submit feedback and the selected attachments to the developer, or export a JSON report to share yourself.</p>
        <label className="feedback-text-label" htmlFor="feedback-text">What would you like to share?</label>
        <textarea
          autoFocus
          disabled={busy}
          id="feedback-text"
          name="feedback"
          onChange={(event) => setFeedback(event.target.value)}
          placeholder="What happened? What did you expect? Suggestions are welcome too."
          required
          rows={5}
          value={feedback}
        />
        <div className="feedback-email-field">
          <label className="feedback-text-label" htmlFor="feedback-email">Email (optional)</label>
          <input id="feedback-email" name="email" type="email" autoComplete="email"
            aria-describedby="feedback-email-help" maxLength={254} disabled={busy}
            value={email} onChange={(event) => setEmail(event.target.value)} />
          <p id="feedback-email-help" className="feedback-description">Include your email if you’d like a reply.</p>
        </div>
        <label className="feedback-checkbox">
          <input checked={includeChat} disabled={busy} name="include-chat" type="checkbox"
            onChange={(event) => setIncludeChat(event.target.checked)} />
          <span>Include this conversation</span>
        </label>
        <div className="feedback-chat-details">
          <strong>{target.title}</strong>
          <span>{target.campaignName}</span>
        </div>
        <p className="feedback-description">Includes messages, tool activity, and diagnostic settings. May contain private campaign information.</p>
        <label className="feedback-checkbox">
          <input checked={includeChat && includeImages} disabled={busy || !includeChat} name="include-images" type="checkbox"
            onChange={(event) => setIncludeImages(event.target.checked)} />
          <span>Include stored images</span>
        </label>
        {includeChat && target.runningWhenOpened ? (
          <p className="feedback-description">The chat was still running when this screen opened. Only saved history is included; the in-progress response may be missing.</p>
        ) : null}
        {error ? <p className="feedback-error" role="alert">{error}</p> : null}
        <div className="feedback-footer">
          <div className="feedback-export-link">
            <button className="link-button" disabled={busy || !feedback.trim()}
              onClick={() => void finishReport(false)} type="button">
              {exporting ? "Exporting…" : "Export as JSON"}
            </button>
          </div>
          <div className="feedback-actions">
          <button disabled={busy} onClick={onClose} type="button">Cancel</button>
          <button className="feedback-export" disabled={busy || !feedback.trim()} type="submit">
            {submitting ? "Submitting…" : "Submit"}
          </button>
          </div>
        </div>
      </form>
    </dialog>
  );
}
