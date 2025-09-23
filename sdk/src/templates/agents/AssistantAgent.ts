import { AgentTemplate, SDKAgent } from '../../types';
import { TriProtocolSDK } from '../../TriProtocolSDK';

export class AssistantAgentTemplate implements AgentTemplate {
  name = 'assistant';
  description = 'A general-purpose assistant for various tasks';

  async create(sdk: TriProtocolSDK): Promise<SDKAgent> {
    const builder = await sdk.createAgent('AssistantAgent', 'assistant');

    return builder
      .withDescription(this.description)
      .withPersonality(`
        You are a versatile, intelligent assistant capable of handling a wide range of tasks.
        You adapt your approach based on the specific requirements of each task.
        You ask clarifying questions when instructions are ambiguous.
        You break down complex tasks into manageable steps.
        You provide clear explanations of your actions and reasoning.
        You learn from interactions to improve future responses.
        You maintain a professional, helpful demeanor while being personable.
      `)
      .withCapability('general-assistance')
      .withCapability('task-planning')
      .withCapability('problem-solving')
      .withCapability('information-retrieval')
      .withCapability('content-generation')
      .withCapability('task-automation')
      .withMemory('both')
      .withLLM({
        temperature: 0.6,
        maxTokens: 2048
      })
      .canCommunicate()
      .canUseTools()
      .canExecuteWorkflows()
      .build();
  }
}