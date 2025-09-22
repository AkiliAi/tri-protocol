import { TriProtocolSDK } from '../TriProtocolSDK';
import { SearchOptions, SDKError } from '../types';
import { v4 as uuidv4 } from 'uuid';

export interface LLMClient {
  complete(prompt: string, options?: any): Promise<string>;
  chat(messages: any[], options?: any): Promise<string>;
  embed(text: string): Promise<number[]>;
}

export interface AgentManagementClient {
  create(name: string): Promise<any>;
  list(): Promise<any[]>;
  get(id: string): Promise<any>;
  delete(id: string): Promise<void>;
}

export interface WorkflowManagementClient {
  create(name: string): Promise<any>;
  list(): Promise<any[]>;
  run(id: string, input: any): Promise<any>;
  status(id: string): Promise<any>;
}

export class TriProtocolClient {
  private sdk: TriProtocolSDK;

  // Sub-clients
  public agents: AgentManagementClient;
  public workflows: WorkflowManagementClient;
  public llm: LLMClient;

  constructor(sdk: TriProtocolSDK) {
    this.sdk = sdk;

    // Initialize sub-clients
    this.agents = this.createAgentClient();
    this.workflows = this.createWorkflowClient();
    this.llm = this.createLLMClient();
  }

  // Simple API for common operations

  async ask(question: string, context?: any): Promise<string> {
    try {
      return await this.sdk.query(question, context);
    } catch (error) {
      throw new SDKError('Failed to process question', 'ASK_ERROR', error);
    }
  }

  async chat(message: string): Promise<string> {
    try {
      return await this.sdk.chat(message);
    } catch (error) {
      throw new SDKError('Failed to chat', 'CHAT_ERROR', error);
    }
  }

  async remember(key: string, value: any): Promise<void> {
    try {
      const persistence = this.sdk.getProtocol().getPersistence();
      if (!persistence) {
        throw new Error('Persistence not configured');
      }
      await persistence.save('memory', key, value);
    } catch (error) {
      throw new SDKError('Failed to save to memory', 'MEMORY_ERROR', error);
    }
  }

  async recall(key: string): Promise<any> {
    try {
      const persistence = this.sdk.getProtocol().getPersistence();
      if (!persistence) {
        throw new Error('Persistence not configured');
      }
      return await persistence.load('memory', key);
    } catch (error) {
      throw new SDKError('Failed to recall from memory', 'MEMORY_ERROR', error);
    }
  }

  async search(query: string, options?: SearchOptions): Promise<any[]> {
    try {
      const persistence = this.sdk.getProtocol().getPersistence();
      if (!persistence) {
        throw new Error('Persistence not configured');
      }

      // Use vector search if available
      if (persistence.searchSimilar) {
        return await persistence.searchSimilar(query, {
          limit: options?.limit || 10,
          threshold: options?.threshold || 0.7,
          ...options
        });
      }

      // Fallback to basic search
      return [];
    } catch (error) {
      throw new SDKError('Failed to search', 'SEARCH_ERROR', error);
    }
  }

  async runTask(task: string, context?: any): Promise<any> {
    try {
      const orchestrator = this.sdk.getProtocol().getOrchestrator();
      return await orchestrator.executeTask({
        id: uuidv4(),
        type: 'simple',
        name: task,
        payload: context,
        status: 'pending'
      });
    } catch (error) {
      throw new SDKError('Failed to run task', 'TASK_ERROR', error);
    }
  }

  async analyze(data: any, analysisType?: string): Promise<any> {
    return this.sdk.analyze(data, analysisType);
  }

  // Batch operations

  async batch(operations: Array<{ type: string; params: any }>): Promise<any[]> {
    const results: any[] = [];

    for (const op of operations) {
      try {
        let result: any;

        switch (op.type) {
          case 'ask':
            result = await this.ask(op.params.question, op.params.context);
            break;
          case 'chat':
            result = await this.chat(op.params.message);
            break;
          case 'task':
            result = await this.runTask(op.params.task, op.params.context);
            break;
          case 'remember':
            await this.remember(op.params.key, op.params.value);
            result = { success: true };
            break;
          case 'recall':
            result = await this.recall(op.params.key);
            break;
          default:
            throw new Error(`Unknown operation type: ${op.type}`);
        }

        results.push({ success: true, result });
      } catch (error) {
        results.push({ success: false, error });
      }
    }

    return results;
  }

  // Stream operations (for future real-time support)

  async *stream(prompt: string, options?: any): AsyncGenerator<string> {
    // Simulated streaming for now
    const response = await this.ask(prompt, options);
    const words = response.split(' ');

    for (const word of words) {
      yield word + ' ';
      // Simulate streaming delay
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  // Helper methods

  async getCapabilities(): Promise<string[]> {
    const agents = await this.agents.list();
    const capabilities = new Set<string>();

    for (const agent of agents) {
      if (agent.capabilities) {
        agent.capabilities.forEach((cap: string) => capabilities.add(cap));
      }
    }

    return Array.from(capabilities);
  }

  async getAvailableTemplates(): Promise<{ agents: string[]; workflows: string[] }> {
    return {
      agents: this.sdk.getAgentTemplates(),
      workflows: this.sdk.getWorkflowTemplates()
    };
  }

  async getStatus(): Promise<any> {
    const protocol = this.sdk.getProtocol();
    const agents = await this.agents.list();
    const workflows = await this.workflows.list();

    return {
      initialized: this.sdk.isInitialized(),
      config: this.sdk.getConfig(),
      agents: agents.length,
      workflows: workflows.length,
      plugins: this.sdk.getPlugins().length,
      protocols: {
        a2a: !!protocol.getProtocol('a2a'),
        mcp: !!protocol.getProtocol('mcp'),
        langgraph: !!protocol.getProtocol('langgraph')
      }
    };
  }

  // Private helper methods

  private createAgentClient(): AgentManagementClient {
    return {
      create: async (name: string) => {
        return this.sdk.createAgent(name);
      },
      list: async () => {
        const registry = this.sdk.getProtocol().getRegistry();
        return registry.list();
      },
      get: async (id: string) => {
        const registry = this.sdk.getProtocol().getRegistry();
        return registry.get(id);
      },
      delete: async (id: string) => {
        const registry = this.sdk.getProtocol().getRegistry();
        await registry.unregister(id);
      }
    };
  }

  private createWorkflowClient(): WorkflowManagementClient {
    return {
      create: async (name: string) => {
        return this.sdk.createWorkflow(name);
      },
      list: async () => {
        const orchestrator = this.sdk.getProtocol().getOrchestrator();
        return orchestrator.listWorkflows();
      },
      run: async (id: string, input: any) => {
        return this.sdk.runWorkflow(id, input);
      },
      status: async (id: string) => {
        return this.sdk.getWorkflowStatus(id);
      }
    };
  }

  private createLLMClient(): LLMClient {
    return {
      complete: async (prompt: string, options?: any) => {
        const llmService = this.sdk.getProtocol().getLLMService();
        return llmService.complete(prompt, options);
      },
      chat: async (messages: any[], options?: any) => {
        const llmService = this.sdk.getProtocol().getLLMService();
        return llmService.chat(messages, options);
      },
      embed: async (text: string) => {
        const embeddingService = this.sdk.getProtocol().getEmbeddingService();
        return embeddingService.generateEmbedding(text);
      }
    };
  }

  // Advanced operations for power users

  async executeRaw(command: any): Promise<any> {
    // Direct protocol access for advanced users
    const protocol = this.sdk.getProtocol();

    if (command.type === 'a2a') {
      const a2a = protocol.getProtocol('a2a');
      return a2a ? a2a.execute(command) : null;
    }

    if (command.type === 'mcp') {
      const mcp = protocol.getProtocol('mcp');
      return mcp ? mcp.execute(command) : null;
    }

    if (command.type === 'langgraph') {
      const lg = protocol.getProtocol('langgraph');
      return lg ? lg.execute(command) : null;
    }

    throw new SDKError('Unknown command type', 'INVALID_COMMAND');
  }

  // Utility methods

  async ping(): Promise<boolean> {
    try {
      await this.getStatus();
      return true;
    } catch {
      return false;
    }
  }

  async healthCheck(): Promise<any> {
    const status = await this.getStatus();
    const health: any = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      ...status
    };

    // Check each component
    try {
      await this.llm.complete('test');
      health.llm = 'healthy';
    } catch {
      health.llm = 'unhealthy';
      health.status = 'degraded';
    }

    try {
      await this.agents.list();
      health.agents = 'healthy';
    } catch {
      health.agents = 'unhealthy';
      health.status = 'degraded';
    }

    try {
      await this.workflows.list();
      health.workflows = 'healthy';
    } catch {
      health.workflows = 'unhealthy';
      health.status = 'degraded';
    }

    return health;
  }
}