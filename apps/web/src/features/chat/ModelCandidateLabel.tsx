import type { AgentModel } from '@agentdeck/shared/conversation';
import { modelDisplay } from '../../cli/shared/model-identity';

export function ModelCandidateLabel({ model }: { model: AgentModel }) {
  const name = modelDisplay(model.id, model);
  return (
    <span className="block truncate" title={name === model.id ? name : `${model.id} → ${name}`}>
      {name}
    </span>
  );
}
