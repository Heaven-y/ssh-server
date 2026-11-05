import { z } from 'zod';
import type { AgentKind } from './agents';

/** 表单只接收允许的字段与脱敏状态，原生文件正文不进入常规设置视图。 */
export type ModelSettingField = {
  key: string;
  label: string;
  value: string;
  group: 'model' | 'connection';
  secret?: boolean;
  hasValue?: boolean;
  hint?: string;
  options?: Array<{ value: string; label: string }>;
  advanced?: boolean;
  inputType?: 'number';
  readOnly?: boolean;
  placeholder?: string;
};
export type NativeModelSettingsDocument = {
  agent: AgentKind;
  revision: string;
  displayPath: string;
  fields: ModelSettingField[];
  providers?: Array<{ id: string; label: string; fields: ModelSettingField[] }>;
  warnings: string[];
};
export const NativeModelSettingsInputSchema = z.strictObject({
  revision: z.string().regex(/^(missing|[a-f0-9]{64})$/),
  changes: z.record(
    z.string().min(1).max(60),
    z
      .string()
      .max(4096)
      .regex(/^[^\r\n\0]*$/)
      .nullable(),
  ),
});
export type NativeModelSettingsInput = z.infer<typeof NativeModelSettingsInputSchema>;
