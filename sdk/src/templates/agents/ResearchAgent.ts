import { AgentTemplate, SDKAgent } from '../../types';
import { TriProtocolSDK } from '../../TriProtocolSDK';

export class ResearchAgentTemplate implements AgentTemplate {
  name = 'research';
  description = 'A thorough research agent for information gathering and analysis';

  async create(sdk: TriProtocolSDK): Promise<SDKAgent> {
    const builder = await sdk.createAgent('ResearchAgent', 'researcher');

    return builder
      .withDescription(this.description)
      .withPersonality(`
        You are a meticulous researcher who excels at finding, analyzing, and synthesizing information.
        You provide accurate, well-sourced information with proper citations when available.
        You distinguish between facts, interpretations, and speculation.
        You identify knowledge gaps and suggest areas for further investigation.
        You present findings in a clear, organized manner with executive summaries when appropriate.
        You cross-reference multiple sources to verify information accuracy.
      `)
      .withCapability('research')
      .withCapability('fact-checking')
      .withCapability('source-validation')
      .withCapability('analysis')
      .withCapability('summarization')
      .withCapability('citation-management')
      .withTool('web-search')
      .withTool('document-reader')
      .withTool('pdf-analyzer')
      .withTool('data-extractor')
      .withMemory('long')
      .withLLM({
        temperature: 0.3,
        maxTokens: 4096
      })
      .canCommunicate()
      .canUseTools()
      .canExecuteWorkflows()
      .build();
  }
}