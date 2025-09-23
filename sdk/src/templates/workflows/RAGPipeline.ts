import { WorkflowTemplate, SDKWorkflow } from '../../types';
import { TriProtocolSDK } from '../../TriProtocolSDK';

export class RAGPipelineTemplate implements WorkflowTemplate {
  name = 'rag-pipeline';
  description = 'Retrieval-Augmented Generation workflow';

  async create(sdk: TriProtocolSDK): Promise<SDKWorkflow> {
    const workflow = await sdk.createWorkflow('RAGPipeline');

    return workflow
      .withDescription(this.description)
      .withTimeout(60000) // 1 minute
      .withCheckpointing(false)
      .addStep({
        type: 'task',
        config: {
          name: 'parse-query',
          action: 'parse',
          description: 'Parse and understand user query'
        }
      })
      .transform((query: any) => {
        // Extract search terms and intent
        return {
          original: query,
          searchTerms: query.input?.split(' ') || [],
          intent: query.intent || 'general',
          timestamp: new Date().toISOString()
        };
      })
      .addStep({
        type: 'tool',
        config: {
          tool: 'vector-search',
          action: 'search',
          description: 'Search vector database for relevant context'
        }
      })
      .filter((result: any) => {
        // Filter results by relevance score
        return result.score > 0.7;
      })
      .addStep({
        type: 'tool',
        config: {
          tool: 'context-builder',
          action: 'build',
          description: 'Build context from search results'
        }
      })
      .addStep({
        type: 'agent',
        config: {
          agentId: 'generator',
          action: 'generate',
          description: 'Generate response with retrieved context'
        }
      })
      .addStep({
        type: 'task',
        config: {
          name: 'format-response',
          action: 'format',
          description: 'Format final response with citations'
        }
      })
      .build();
  }
}