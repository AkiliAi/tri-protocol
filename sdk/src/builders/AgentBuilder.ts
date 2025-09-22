import { TriProtocol, TriAgent } from '../types/core-types';
import { EventEmitter } from 'eventemitter3';
import { v4 as uuidv4 } from 'uuid';
import {
  SDKAgent,
  AgentConfig,
  MemoryConfig,
  AgentCapability,
  ToolDefinition,
  AgentState,
  SDKError
} from '../types';

export class SDKAgentImpl extends EventEmitter implements SDKAgent {
  id: string;
  name: string;
  description?: string;
  capabilities: string[] = [];
  tools: string[] = [];
  memory?: MemoryConfig;

  private agent?: TriAgent;
  private protocol: TriProtocol;
  private config: AgentConfig;
  private state: AgentState = { status: 'idle' };

  constructor(protocol: TriProtocol, config: AgentConfig) {
    super();
    this.id = uuidv4();
    this.name = config.name || 'Agent';
    this.description = config.description;
    this.protocol = protocol;
    this.config = config;
    this.capabilities = config.capabilities || [];
    this.tools = config.tools || [];
    this.memory = config.memory;
  }

  async initialize(): Promise<void> {
    try {
      // Create underlying TriAgent
      this.agent = new TriAgent({
        id: this.id,
        name: this.name,
        capabilities: this.capabilities,
        metadata: {
          description: this.description,
          systemPrompt: this.config.systemPrompt,
          llm: this.config.llm,
          enableA2A: this.config.enableA2A,
          enableMCP: this.config.enableMCP,
          enableLangGraph: this.config.enableLangGraph
        }
      });

      // Register with the protocol
      await this.protocol.registerAgent(this.agent);

      // Setup memory if configured
      if (this.memory?.enabled) {
        await this.setupMemory();
      }

      // Register tools
      for (const tool of this.tools) {
        await this.registerTool(tool);
      }

      this.emit('initialized');
    } catch (error) {
      throw new SDKError('Failed to initialize agent', 'AGENT_INIT_ERROR', error);
    }
  }

  async respond(input: string, context?: any): Promise<string> {
    this.state = { status: 'thinking', currentTask: { input, context } };
    this.emit('state:changed', this.state);

    try {
      const llmService = this.protocol.getLLMService();
      const systemPrompt = this.config.systemPrompt || 'You are a helpful assistant.';

      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: input }
      ];

      // Add context if available
      if (context) {
        messages.push({ role: 'system', content: `Context: ${JSON.stringify(context)}` });
      }

      // Add memory context if available
      if (this.memory?.enabled) {
        const memoryContext = await this.getMemoryContext(input);
        if (memoryContext) {
          messages.push({ role: 'system', content: `Memory: ${memoryContext}` });
        }
      }

      const response = await llmService.chat(messages, this.config.llm);

      // Store in memory if enabled
      if (this.memory?.enabled) {
        await this.storeInMemory(input, response);
      }

      this.state = { status: 'idle' };
      this.emit('state:changed', this.state);
      this.emit('response', { input, response });

      return response;
    } catch (error) {
      this.state = { status: 'idle' };
      this.emit('state:changed', this.state);
      throw new SDKError('Failed to generate response', 'RESPONSE_ERROR', error);
    }
  }

  async think(prompt: string): Promise<string> {
    return this.respond(prompt);
  }

  async execute(task: any): Promise<any> {
    this.state = { status: 'executing', currentTask: task };
    this.emit('state:changed', this.state);

    try {
      const orchestrator = this.protocol.getOrchestrator();
      const result = await orchestrator.executeTask({
        id: uuidv4(),
        agentId: this.id,
        type: task.type || 'simple',
        payload: task,
        status: 'pending'
      });

      this.state = { status: 'idle' };
      this.emit('state:changed', this.state);
      this.emit('task:completed', { task, result });

      return result;
    } catch (error) {
      this.state = { status: 'idle' };
      this.emit('state:changed', this.state);
      throw new SDKError('Failed to execute task', 'EXECUTION_ERROR', error);
    }
  }

  async addCapability(capability: string | AgentCapability): Promise<void> {
    const cap = typeof capability === 'string' ? capability : capability.name;
    if (!this.capabilities.includes(cap)) {
      this.capabilities.push(cap);
      if (this.agent) {
        this.agent.capabilities.push(cap);
      }
      this.emit('capability:added', cap);
    }
  }

  async addTool(tool: string | ToolDefinition): Promise<void> {
    const toolName = typeof tool === 'string' ? tool : tool.name;
    if (!this.tools.includes(toolName)) {
      this.tools.push(toolName);
      await this.registerTool(tool);
      this.emit('tool:added', toolName);
    }
  }

  async enableMemory(config: MemoryConfig): Promise<void> {
    this.memory = config;
    await this.setupMemory();
    this.emit('memory:enabled', config);
  }

  async communicate(agentId: string, message: any): Promise<any> {
    this.state = { status: 'communicating', currentTask: { agentId, message } };
    this.emit('state:changed', this.state);

    try {
      const a2aProtocol = this.protocol.getProtocol('a2a');
      if (!a2aProtocol) {
        throw new Error('A2A protocol not enabled');
      }

      const response = await a2aProtocol.sendMessage(agentId, message);

      this.state = { status: 'idle' };
      this.emit('state:changed', this.state);
      this.emit('communication:completed', { agentId, message, response });

      return response;
    } catch (error) {
      this.state = { status: 'idle' };
      this.emit('state:changed', this.state);
      throw new SDKError('Failed to communicate with agent', 'COMMUNICATION_ERROR', error);
    }
  }

  getState(): AgentState {
    return { ...this.state };
  }

  private async setupMemory(): Promise<void> {
    if (!this.memory?.enabled) return;

    const persistence = this.protocol.getPersistence();
    if (!persistence) {
      throw new Error('Persistence not configured for memory');
    }

    // Initialize memory storage
    const memoryKey = `agent:${this.id}:memory`;
    await persistence!.save('metadata', memoryKey, {
      type: this.memory.type,
      ttl: this.memory.ttl,
      maxEntries: this.memory.maxEntries,
      created: new Date().toISOString()
    });
  }

  private async getMemoryContext(input: string): Promise<string | null> {
    if (!this.memory?.enabled) return null;

    try {
      const persistence = this.protocol.getPersistence();
      const memoryKey = `agent:${this.id}:memory:context`;
      const context = await persistence?.load('memory', memoryKey);
      return context ? JSON.stringify(context) : null;
    } catch {
      return null;
    }
  }

  private async storeInMemory(input: string, response: string): Promise<void> {
    if (!this.memory?.enabled) return;

    try {
      const persistence = this.protocol.getPersistence();
      if (!persistence) return;

      const memoryKey = `agent:${this.id}:memory:history`;

      // Load existing history
      let history = await persistence.load('memory', memoryKey) || [];

      // Add new entry
      history.push({
        timestamp: new Date().toISOString(),
        input,
        response
      });

      // Limit entries if configured
      if (this.memory.maxEntries && history.length > this.memory.maxEntries) {
        history = history.slice(-this.memory.maxEntries);
      }

      await persistence.save('memory', memoryKey, history);
    } catch (error) {
      // Memory storage failure shouldn't break the agent
      console.error('Failed to store in memory:', error);
    }
  }

  private async registerTool(tool: string | ToolDefinition): Promise<void> {
    if (this.config.enableMCP) {
      const mcpProtocol = this.protocol.getProtocol('mcp');
      if (mcpProtocol) {
        // Register tool with MCP
        const toolDef = typeof tool === 'object' ? tool : { name: tool };
        await mcpProtocol.registerTool(toolDef);
      }
    }
  }
}

interface AgentTemplateConfig {
  [key: string]: any;
}

const AgentTemplates: Record<string, AgentTemplateConfig> = {
  assistant: {
    systemPrompt: 'You are a helpful, friendly assistant.',
    capabilities: ['conversation', 'general-knowledge'],
    enableA2A: true,
    enableMCP: true
  },
  researcher: {
    systemPrompt: 'You are a thorough researcher who provides accurate, well-sourced information.',
    capabilities: ['research', 'analysis', 'fact-checking'],
    enableMCP: true,
    enableLangGraph: true
  },
  analyst: {
    systemPrompt: 'You are a data analyst expert in statistical analysis and data visualization.',
    capabilities: ['data-analysis', 'visualization', 'statistics'],
    enableMCP: true,
    enableLangGraph: true
  },
  coder: {
    systemPrompt: 'You are an expert programmer who writes clean, efficient, well-documented code.',
    capabilities: ['code-generation', 'debugging', 'code-review'],
    enableMCP: true
  }
};

export class AgentBuilder {
  private config: AgentConfig = {};
  private capabilities: string[] = [];
  private tools: (string | ToolDefinition)[] = [];
  private memory?: MemoryConfig;
  private sdk?: any;

  constructor(private protocol: TriProtocol, sdk?: any) {
    this.sdk = sdk;
  }

  withName(name: string): this {
    this.config.name = name;
    return this;
  }

  withDescription(description: string): this {
    this.config.description = description;
    return this;
  }

  withCapability(capability: string | AgentCapability): this {
    const cap = typeof capability === 'string' ? capability : capability.name;
    this.capabilities.push(cap);
    return this;
  }

  withTool(tool: string | ToolDefinition): this {
    this.tools.push(tool);
    return this;
  }

  withMemory(type: 'short' | 'long' | 'both' = 'both'): this {
    this.memory = { enabled: true, type };
    return this;
  }

  withLLM(config?: any): this {
    this.config.llm = config || {};
    return this;
  }

  // withPersistence(strategy: 'hybrid' | 'single' = 'hybrid'): this {
  //   this.config.persistence = this.createPersistence(strategy);
  //   return this;
  // }
  //
  // withVectorMemory(dimensions: number = 768): this {
  //   this.config.vectorMemory = {
  //     enabled: true,
  //     dimensions,
  //     provider: 'ollama'
  //   };
  //   return this;
  // }


  fromTemplate(template: string): this {
    const templateConfig = AgentTemplates[template.toLowerCase()];
    if (templateConfig) {
      Object.assign(this.config, templateConfig);
      if (templateConfig.capabilities) {
        this.capabilities.push(...templateConfig.capabilities);
      }
    }
    return this;
  }

  withPersonality(personality: string): this {
    this.config.systemPrompt = personality;
    return this;
  }

  canCommunicate(): this {
    this.config.enableA2A = true;
    return this;
  }

  canUseTools(): this {
    this.config.enableMCP = true;
    return this;
  }

  canExecuteWorkflows(): this {
    this.config.enableLangGraph = true;
    return this;
  }

  async build(): Promise<SDKAgent> {
    // Merge all configurations
    const finalConfig: AgentConfig = {
      ...this.config,
      capabilities: [...(this.config.capabilities || []), ...this.capabilities],
      tools: [...(this.config.tools || []), ...this.tools.map(t => typeof t === 'string' ? t : t.name)],
      memory: this.memory || this.config.memory
    };

    const agent = new SDKAgentImpl(this.protocol, finalConfig);

    // Register additional tools
    for (const tool of this.tools) {
      await agent.addTool(tool);
    }

    // Setup memory if configured
    if (this.memory) {
      await agent.enableMemory(this.memory);
    }

    await agent.initialize();

    // Emit event if SDK is available
    if (this.sdk) {
      this.sdk.emit('agent:created', agent);
    }

    return agent;
  }
}