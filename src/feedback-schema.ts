import { z } from "zod";
import { isSupportedUploadedImageType } from "./extension/chat-images";

const nonempty = z.string().min(1);
export const feedbackEmailSchema = z.email().max(254);
const opaqueObject = z.custom<object>((value) =>
  value !== null && typeof value === "object" && !Array.isArray(value));

export const feedbackImageSchema = z.object({
  imageId: nonempty,
  filename: nonempty,
  mediaType: nonempty.refine(isSupportedUploadedImageType),
  size: z.number().int().positive(),
  encoding: z.literal("base64"),
  data: nonempty,
});

/** The envelope is versioned; chat, tool and snapshot contents remain opaque
 * diagnostics. Upload byte/count limits and image signatures are checked by the
 * receiver separately, so local exports need not obey upload size limits. */
export const feedbackReportSchema = z.object({
  format: z.literal("gmtools-feedback"),
  formatVersion: z.literal(1),
  reportId: nonempty,
  exportedAt: nonempty.refine((value) => Number.isFinite(Date.parse(value))),
  feedback: nonempty.max(100_000).refine((value) => value.trim().length > 0),
  email: feedbackEmailSchema.optional(),
  extension: z.object({ version: nonempty, buildId: nonempty, browser: nonempty }),
  includes: z.object({ chat: z.boolean(), images: z.boolean() }),
  conversation: z.object({
    chat: opaqueObject,
    messages: z.array(z.unknown()),
    snapshots: z.array(z.unknown()),
    images: z.array(feedbackImageSchema),
    omittedImageCount: z.number().int().nonnegative().optional(),
    missingSnapshotHashes: z.array(z.string()).optional(),
    missingImageIds: z.array(z.string()).optional(),
    savedAt: z.number().nullable().optional(),
    historySource: z.literal("indexeddb").optional(),
    runningWhenOpened: z.boolean().optional(),
    visibleError: z.string().optional(),
  }).optional(),
}).superRefine((report, context) => {
  if (!report.includes.chat && (report.includes.images || report.conversation !== undefined)) {
    context.addIssue({ code: "custom", message: "Chat data was not opted in." });
  }
  if (report.includes.chat && !report.conversation) {
    context.addIssue({ code: "custom", message: "Conversation is missing." });
  }
  if (!report.includes.images && report.conversation?.images.length) {
    context.addIssue({ code: "custom", message: "Images were not opted in." });
  }
});

export type FeedbackImage = z.infer<typeof feedbackImageSchema>;
export type FeedbackReport = z.infer<typeof feedbackReportSchema>;
