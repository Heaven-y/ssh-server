import type { NativeConfigAgent } from '@ssh-server/shared';

/** 公开静态示例，不读取登录信息、环境变量或任何配置文件。 */
export function nativeConfigTemplate(agent: NativeConfigAgent): { content: string; notes: string[] } {
  if (agent === 'claude') {
    return {
      content: '{}\n',
      notes: [
        'JSON 不支持注释。最小内容为 {}，无需填写密钥即可保存；不需要覆盖默认值时也可以不创建文件。',
        'model（可选）：模型 ID 或别名，例如 {"model":"sonnet"}。请以原生工具和服务商实际支持的模型为准，不填则沿用原生默认。',
        'env（可选）：环境变量名到字符串值的对象，例如 {"env":{}}。ANTHROPIC_API_KEY 是 Claude 的 API 密钥环境变量，不是 SSH 密码；只在明确采用对应密钥认证时设置，不要填示例密钥。',
      ],
    };
  }
  return {
    content: [
      '# 最小配置：保留原生默认，不在此处填写登录信息。',
      '# 可选：取消注释前，将模型占位符替换为实际支持的模型 ID。',
      '# model = "your-model-id"',
      '# 可选：仅在所选模型支持时指定推理强度；不填则跟随原生设置。',
      '# model_reasoning_effort = "medium"',
      '',
    ].join('\n'),
    notes: [
      'TOML 支持 # 注释。此模板全部为注释，保存不会选择模型、改变认证或添加密钥。',
      'model（可选）：字符串形式的模型 ID；先替换 your-model-id，再取消该行注释。',
      'model_reasoning_effort（可选）：推理强度，例如 medium；可用档位取决于实际模型与原生版本，不填则沿用原生默认。',
    ],
  };
}
