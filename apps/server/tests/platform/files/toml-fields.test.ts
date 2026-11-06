import { parse } from 'smol-toml';
import { describe, expect, it } from 'vitest';
import { updateTomlFields } from '../../../src/platform/files/toml-fields';

describe('原生 TOML 字段编辑', () => {
  it('带 UTF-8 BOM 的配置可定点修改，并保留 BOM、注释与换行', () => {
    const source = '\uFEFF# 原生配置\r\nmodel = "old" # 保留\r\n[unknown]\r\nenabled = true\r\n';
    expect(updateTomlFields(source, [{ path: ['model'], value: 'new' }])).toBe(source.replace('"old"', '"new"'));
    expect(updateTomlFields(source, [])).toBe(source);
    expect(updateTomlFields('\uFEFF', [{ path: ['model'], value: 'new' }])).toBe('\uFEFFmodel = "new"\n');
  });

  it('只替换根与普通表中的目标值，保留注释、未知配置与 CRLF', () => {
    const source = [
      '# 原生配置',
      "model = 'old' # 用户说明",
      'model_provider = "custom"',
      '[model_providers.custom]',
      'base_url = "https://old.invalid/v1" # 服务端点',
      'requires_openai_auth = true',
      '[unrelated]',
      'values = [1, 2, 3]',
      'date = 2026-01-01',
      '',
    ].join('\r\n');
    const result = updateTomlFields(source, [
      { path: ['model'], value: 'new' },
      { path: ['model_providers', 'custom', 'base_url'], value: 'https://new.invalid/v1' },
      { path: ['model_providers', 'custom', 'requires_openai_auth'], value: false },
    ]);
    expect(result).toBe(
      source
        .replace("'old'", '"new"')
        .replace('https://old.invalid/v1', 'https://new.invalid/v1')
        .replace('requires_openai_auth = true', 'requires_openai_auth = false'),
    );
    expect(parse(result)).toMatchObject({ model: 'new', model_providers: { custom: { requires_openai_auth: false } } });
  });

  it('区分带引号的段与 dotted key，不把点号误当作目录层级', () => {
    const source = [
      '"model" = "old"',
      'model_providers."custom.provider".\'name\' = "old name" # 保留',
      'model_providers."custom.provider".env_key = "OLD_KEY" # 用户自己设置',
      '[model_providers.other]',
      'name = "untouched"',
      '',
    ].join('\n');
    const result = updateTomlFields(source, [
      { path: ['model'], value: 'new' },
      { path: ['model_providers', 'custom.provider', 'name'], value: '新名称' },
      { path: ['model_providers', 'custom.provider', 'env_key'], value: null },
      { path: ['model_providers', 'custom.provider', 'wire_api'], value: 'responses' },
    ]);
    expect(result).toContain('model_providers."custom.provider".\'name\' = "新名称" # 保留');
    expect(result).toContain('# 用户自己设置');
    expect(result).toContain('[model_providers.other]\nname = "untouched"');
    expect(parse(result)).toMatchObject({
      model: 'new',
      model_providers: { 'custom.provider': { name: '新名称', wire_api: 'responses' } },
    });
    expect(parse(result)).not.toHaveProperty('model_providers.custom');
  });

  it('缺少根字段时插到首个表之前，缺少表内字段时保持正确作用域', () => {
    const source = '[model_providers."custom.provider"] # 服务\nname = "custom"\n[other]\nenabled = true\n';
    const result = updateTomlFields(source, [
      { path: ['model'], value: 'example-model' },
      { path: ['model_provider'], value: 'custom.provider' },
      { path: ['model_providers', 'custom.provider', 'base_url'], value: 'https://example.invalid/v1' },
    ]);
    expect(result).toBe(
      'model = "example-model"\nmodel_provider = "custom.provider"\n' +
        '[model_providers."custom.provider"] # 服务\nname = "custom"\n' +
        'base_url = "https://example.invalid/v1"\n[other]\nenabled = true\n',
    );
    expect(parse(result)).toMatchObject({
      model: 'example-model',
      model_providers: { 'custom.provider': { base_url: 'https://example.invalid/v1' } },
      other: { enabled: true },
    });
  });

  it('空配置可补齐字段，新增值按 TOML 字符串转义', () => {
    const token = 'quote"\\line\n\u007f';
    const result = updateTomlFields('', [
      { path: ['model'], value: 'example-model' },
      { path: ['model_provider'], value: 'custom' },
      { path: ['model_providers', 'custom', 'name'], value: '自定义服务' },
      { path: ['model_providers', 'custom', 'experimental_bearer_token'], value: token },
      { path: ['model_providers', 'custom', 'requires_openai_auth'], value: false },
    ]);
    expect(parse(result)).toEqual({
      model: 'example-model',
      model_provider: 'custom',
      model_providers: {
        custom: { name: '自定义服务', experimental_bearer_token: token, requires_openai_auth: false },
      },
    });
  });

  it('嵌套 inline table 支持修改、补充和删除，保留未知字段原文', () => {
    const source =
      'model_providers = { "custom.provider" = { name = \'old\', unknown = [1, 2], env_key = "KEY" } } # 保留\n';
    const result = updateTomlFields(source, [
      { path: ['model_providers', 'custom.provider', 'name'], value: 'new' },
      { path: ['model_providers', 'custom.provider', 'wire_api'], value: 'responses' },
      { path: ['model_providers', 'custom.provider', 'env_key'], value: null },
    ]);
    expect(result).toContain('unknown = [1, 2]');
    expect(result).toContain('} } # 保留\n');
    expect(parse(result)).toEqual({
      model_providers: { 'custom.provider': { name: 'new', unknown: [1, 2], wire_api: 'responses' } },
    });
  });

  it.each(['first', 'middle', 'last'])('删除 inline table 的 %s 字段会正确处理分隔符', (key) => {
    const result = updateTomlFields('provider = { first = "a", middle = "b", last = "c" }\n', [
      { path: ['provider', key], value: null },
    ]);
    const expected: Record<string, string> = { first: 'a', middle: 'b', last: 'c' };
    delete expected[key];
    expect(parse(result)).toEqual({ provider: expected });
  });

  it('空 inline table 可填入字段，删除最后一个字段后保留容器', () => {
    const source = 'provider = { } # 自定义\n';
    const added = updateTomlFields(source, [{ path: ['provider', 'nested', 'name'], value: 'custom' }]);
    expect(parse(added)).toEqual({ provider: { nested: { name: 'custom' } } });
    expect(updateTomlFields(added, [{ path: ['provider', 'nested', 'name'], value: null }])).toBe(source);
  });

  it('无需更新与删除不存在字段时不改变原文；删除保留同行注释', () => {
    const source = "# 顶部\nmodel = 'unchanged' # 仍保留注释\n";
    expect(updateTomlFields(source, [{ path: ['model'], value: 'unchanged' }])).toBe(source);
    expect(updateTomlFields(source, [{ path: ['absent'], value: null }])).toBe(source);
    expect(updateTomlFields(source, [])).toBe(source);
    expect(updateTomlFields(source, [{ path: ['model'], value: null }])).toBe('# 顶部\n # 仍保留注释\n');
  });

  it.each([
    ['[[model_providers.custom]]\nname = "old"\n', ['model_providers', 'custom', 'name']],
    ['model_providers = "scalar"\n', ['model_providers', 'custom', 'name']],
    ['model = { unknown = "preserve" }\n', ['model']],
    ['model = ["preserve"]\n', ['model']],
    ['[model.unknown]\nvalue = "preserve"\n', ['model']],
    ['model.unknown = "preserve"\n', ['model']],
  ])('结构不适合字段编辑时明确拒绝，未知内容不被覆盖', (source, path) => {
    expect(() => updateTomlFields(source, [{ path, value: 'replacement' }])).toThrow('无法安全更新 TOML 配置');
  });

  it('不接受不完整语法、空路径和 TOML 1.1 多行 inline table，错误不包含配置值', () => {
    for (const source of ['model = "unfinished', 'provider = {\n name = "custom"\n}\n']) {
      expect(() => updateTomlFields(source, [{ path: ['model'], value: 'new' }])).toThrow(
        '无法安全更新 TOML 配置，请使用原文编辑。',
      );
    }
    expect(() => updateTomlFields('', [{ path: [], value: 'new' }])).toThrow('无法安全更新 TOML 配置');
  });
});
