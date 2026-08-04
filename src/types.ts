import { z } from 'zod';
export type MessageType = 'text' | 'image' | 'document' | 'video' | 'audio' | 'sticker' | 'link' | 'unknown';
export type Attachment = {
  status: 'downloaded' | 'failed' | 'skipped';
  originalFileName: string;
  storedFileName?: string;
  relativePath?: string;
  mimeType?: string;
  sizeBytes?: number;
  sha256?: string;
  error?: string;
};
export type PlacementMessage = {
  schemaVersion: 1;
  messageId: string;
  chatIdHash: string;
  groupName: string | null;
  senderHash: string | null;
  senderDisplayName: string | null;
  timestamp: string;
  receivedAt: string;
  type: MessageType;
  text: string | null;
  caption: string | null;
  isForwarded: boolean;
  isReply: boolean;
  quotedMessageId: string | null;
  attachment: Attachment | null;
  parseWarnings: string[];
};
export const attachmentSchema = z.object({
  status: z.enum(['downloaded', 'failed', 'skipped']),
  originalFileName: z.string(),
  storedFileName: z.string().optional(),
  relativePath: z.string().optional(),
  mimeType: z.string().optional(),
  sizeBytes: z.number().nonnegative().optional(),
  sha256: z.string().optional(),
  error: z.string().optional(),
});
export const placementMessageSchema = z.object({
  schemaVersion: z.literal(1),
  messageId: z.string().min(1),
  chatIdHash: z.string().length(16),
  groupName: z.string().nullable(),
  senderHash: z.string().length(16).nullable(),
  senderDisplayName: z.string().nullable(),
  timestamp: z.string().datetime({ offset: true }),
  receivedAt: z.string().datetime({ offset: true }),
  type: z.enum(['text', 'image', 'document', 'video', 'audio', 'sticker', 'link', 'unknown']),
  text: z.string().nullable(),
  caption: z.string().nullable(),
  isForwarded: z.boolean(),
  isReply: z.boolean(),
  quotedMessageId: z.string().nullable(),
  attachment: attachmentSchema.nullable(),
  parseWarnings: z.array(z.string()),
});
