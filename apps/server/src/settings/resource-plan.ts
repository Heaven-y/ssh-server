import { builder, type ResourceContext, type ResourcePlan } from '../agents/common/configuration/resources';
import { cliConfigurations } from '../agents/registry';
export function resourcePlan(context: ResourceContext): ResourcePlan {
  const output = builder(context);
  cliConfigurations[context.agent].resources(context, output);
  output.plan.guidance.push({
    label: '原生发现范围',
    description: '列出标准文件与有界目录资源；自定义路径、继承、组织策略和实际生效顺序仍由 CLI 处理。',
  });
  return output.plan;
}
