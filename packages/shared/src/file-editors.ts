import { z } from 'zod';

/** 只登记编辑状态，不发送文件正文。 */
export const FileEditorStateSchema = z
  .object({
    path: z.string().max(4096).nullable(),
    dirty: z.boolean(),
    busy: z.boolean(),
  })
  .strict();
export type FileEditorState = z.infer<typeof FileEditorStateSchema>;
export const FileEditorMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('state'), state: FileEditorStateSchema }).strict(),
  z.object({ type: z.literal('reserved'), token: z.string().uuid(), state: FileEditorStateSchema }).strict(),
  z.object({ type: z.literal('release') }).strict(),
]);
export type FileEditorMessage = z.infer<typeof FileEditorMessageSchema>;
export type FileEditorServerMessage =
  | { type: 'ready' }
  | { type: 'reserve'; token: string }
  | { type: 'unlock'; token: string }
  | { type: 'error'; message: string };
