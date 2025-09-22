import { WorkflowTemplate, SDKWorkflow } from '../../types';
import { TriProtocolSDK } from '../../TriProtocolSDK';

export class MultiAgentChatTemplate implements WorkflowTemplate {
  name = 'multi-agent-chat';
  description = 'Coordinated chat between multiple specialized agents';

  async create(sdk: TriProtocolSDK): Promise<SDKWorkflow> {
    const workflow = await sdk.createWorkflow('MultiAgentChat');

    return workflow
      .withDescription(this.description)
      .withTimeout(120000) // 2 minutes
      .addStep({
        type: 'task',
        config: {
          name: 'route-query',
          action: 'analyze',
          description: 'Analyze query to determine best agent'
        }
      })
      .condition('requiresResearch')
        .then((builder: any) => {
          builder
            .useAgent('researcher', 'research')
            .useAgent('analyst', 'analyze');
        })
        .else((builder: any) => {
          builder.useAgent('assistant', 'respond');
        })
      .addStep({
        type: 'agent',
        config: {
          agentId: 'synthesizer',
          action: 'synthesize',
          description: 'Synthesize responses from multiple agents'
        }
      })
      .addStep({
        type: 'task',
        config: {
          name: 'format-response',
          action: 'format',
          description: 'Format and polish final response'
        }
      })
      .build();
  }
}