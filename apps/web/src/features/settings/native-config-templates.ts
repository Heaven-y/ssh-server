import type { NativeConfigAgent } from '@ssh-server/shared';

/** 原生配置的最小模板。 */
export function nativeConfigTemplate(agent: NativeConfigAgent): { content: string; notes: string[] } {
  if (agent === 'claude') {
    return {
      content: '{}\n',
      notes: [
        'JSON 不支持注释。最小内容为 {}；不需要覆盖默认值时可不创建文件。',
        'model（可选）：模型 ID 或别名，例如 {"model":"sonnet"}。',
        'env（可选）：环境变量名到字符串值的对象，例如 {"env":{}}。',
      ],
    };
  }
  return {
    content: [
      '# 最小配置：全部使用原生默认。',
      '# 可选：替换为实际模型 ID 后取消注释。',
      '# model = "your-model-id"',
      '# 可选：推理强度。',
      '# model_reasoning_effort = "medium"',
      '',
    ].join('\n'),
    notes: [
      'TOML 支持 # 注释，此模板全部为注释。',
      'model（可选）：字符串形式的模型 ID；替换 your-model-id 后取消该行注释。',
      'model_reasoning_effort（可选）：推理强度，例如 medium。',
    ],
  };
}
