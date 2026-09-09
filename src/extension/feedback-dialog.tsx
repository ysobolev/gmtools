import { useEffect, useRef, useState } from "react";
import { EXTENSION_BROWSER_NAME, EXTENSION_BUILD_ID, EXTENSION_VERSION } from "../build-info";
import { createFeedbackReport, downloadFeedbackReport } from "./feedback-report";

export interface FeedbackTarget {
  readonly chatId: string;
  readonly title: string;
  readonly campaignName: string;
  readonly visibleError?: string | undefined;
  readonly runningWhenOpened: boolean;
}

export function FeedbackDialog({ target, onClose, onExported }: {
  readonly target: FeedbackTarget;
  readonly onClose: () => void;
  readonly onExported: () => void;
}): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [feedback, setFeedback] = useState("");
  const [includeChat, setIncludeChat] = useState(true);
  const [includeImages, setIncludeImages] = useState(false);
  const [exporting, setExporting] = useState(false);
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

  async function exportReport(): Promise<void> {
    setExporting(true);
    setError(null);
    try {
      const report = await createFeedbackReport({
        ...target, feedback, includeChat, includeImages,
        extension: { version: EXTENSION_VERSION, buildId: EXTENSION_BUILD_ID, browser: EXTENSION_BROWSER_NAME },
      });
      downloadFeedbackReport(report);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not export feedback.");
      return;
    } finally {
      setExporting(false);
    }
    onExported();
  }

  return (
    <dialog
      aria-labelledby="feedback-heading"
      className="feedback-dialog"
      onCancel={(event) => {
        event.preventDefault();
        if (!exporting) onClose();
      }}
      ref={dialogRef}
    >
      <form onSubmit={(event) => { event.preventDefault(); void exportReport(); }}>
        <h2 id="feedback-heading">Feedback</h2>
        <p className="feedback-description">Export a JSON report to email or message to the developer. Nothing is sent automatically.</p>
        <label className="feedback-text-label" htmlFor="feedback-text">What would you like to share?</label>
        <textarea
          autoFocus
          disabled={exporting}
          id="feedback-text"
          name="feedback"
          onChange={(event) => setFeedback(event.target.value)}
          placeholder="What happened? What did you expect? Suggestions are welcome too."
          required
          rows={5}
          value={feedback}
        />
        <label className="feedback-checkbox">
          <input checked={includeChat} disabled={exporting} name="include-chat" type="checkbox"
            onChange={(event) => setIncludeChat(event.target.checked)} />
          <span>Include this conversation</span>
        </label>
        <div className="feedback-chat-details">
          <strong>{target.title}</strong>
          <span>{target.campaignName}</span>
        </div>
        <p className="feedback-description">Includes messages, tool activity, and diagnostic settings. May contain private campaign information.</p>
        <label className="feedback-checkbox">
          <input checked={includeChat && includeImages} disabled={exporting || !includeChat} name="include-images" type="checkbox"
            onChange={(event) => setIncludeImages(event.target.checked)} />
          <span>Include stored images</span>
        </label>
        {includeChat && target.runningWhenOpened ? (
          <p className="feedback-description">The chat was still running when this screen opened. Only saved history is exported; the in-progress response may be missing.</p>
        ) : null}
        {error ? <p className="feedback-error" role="alert">{error}</p> : null}
        <div className="feedback-actions">
          <button disabled={exporting} onClick={onClose} type="button">Cancel</button>
          <button className="feedback-export" disabled={exporting || !feedback.trim()} type="submit">
            {exporting ? "Exporting…" : "Export"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
