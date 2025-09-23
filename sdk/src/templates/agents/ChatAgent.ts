import { AgentTemplate, SDKAgent } from '../../types';
import { TriProtocolSDK } from '../../TriProtocolSDK';

export class ChatAgentTemplate implements AgentTemplate {
  name = 'chat';
  description = 'A conversational agent with memory and context management';

  async create(sdk: TriProtocolSDK): Promise<SDKAgent> {
    const builder = await sdk.createAgent('ChatAgent', 'assistant');

    return builder
      .withDescription(this.description)
      .withPersonality(`
        You are a helpful, friendly, and conversational assistant.
        You maintain context across conversations and remember important details.
        You can access tools and communicate with other agents when needed.
        You provide thoughtful, relevant responses while being concise and clear.
        You adapt your communication style to match the user's preferences.
      `)
      .withCapability('conversation')
      .withCapability('context-management')
      .withCapability('memory-recall')
      .withCapability('multi-turn-dialogue')
      .withMemory('both')
      .withLLM({
        temperature: 0.7,
        maxTokens: 2048
      })
      .canCommunicate()
      .canUseTools()
      .build();
  }
}