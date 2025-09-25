import { TriProtocol, TriAgent, TriOrchestrator, TriRegistry, PersistenceManager } from './types/core-types';
import { A2AProtocol, MCPAdapter, LangGraphAdapter, LoggerManager } from './types/protocol-types';
import { EventEmitter } from 'eventemitter3';
import {
  SDKConfig,
  SDKAgent,
  SDKWorkflow,
  Plugin,
  QueryAnalysis,
  SDKError,
  AgentTemplate,
  WorkflowTemplate
} from './types';

export class TriProtocolSDK extends EventEmitter {
  private static instance: TriProtocolSDK;
  private protocol!: TriProtocol;
  private client!: any;
  private config: SDKConfig;
  private plugins: Map<string, Plugin> = new Map();
  private agentTemplates: Map<string, AgentTemplate> = new Map();
  private workflowTemplates: Map<string, WorkflowTemplate> = new Map();
  private logger: any;
  private initialized = false;

  private chatAgent?: SDKAgent;
  private analystAgent?: SDKAgent;

  private constructor(config: SDKConfig = {}) {
    super();
    this.config = this.normalizeConfig(config);
    this.logger = LoggerManager.getLogger('TriProtocolSDK');
  }

  static create(config?: SDKConfig): TriProtocolSDK {
    if (!TriProtocolSDK.instance) {
      TriProtocolSDK.instance = new TriProtocolSDK(config);
    }
    return TriProtocolSDK.instance;
  }

  static async initialize(config?: SDKConfig): Promise<TriProtocolSDK> {
    const sdk = TriProtocolSDK.create(config);
    await sdk.initialize();
    return sdk;
  }

  private normalizeConfig(config: SDKConfig): SDKConfig {
    const defaults: SDKConfig = {
      mode: config.mode || 'development',
      persistence: {
        enabled: config.persistence?.enabled !== false,
        backend: config.persistence?.backend || (config.mode === 'production' ? 'mongodb' : 'memory'),
        config: config.persistence?.config || {}
      },
      llm: {
        provider: config.llm?.provider || 'ollama',
        model: config.llm?.model,
        apiKey: config.llm?.apiKey,
        endpoint: config.llm?.endpoint,
        temperature: config.llm?.temperature || 0.7,
        maxTokens: config.llm?.maxTokens || 2048
      },
      protocols: {
        a2a: config.protocols?.a2a !== false,
        mcp: config.protocols?.mcp !== false,
        langgraph: config.protocols?.langgraph !== false
      },
      logging: {
        level: config.logging?.level || (config.mode === 'development' ? 'debug' : 'info'),
        enabled: config.logging?.enabled !== false
      },
      advanced: config.advanced || {}
    };

    return { ...defaults, ...config };
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      this.logger.info('Initializing Tri-Protocol SDK...');

      // Initialize core protocol
      // Transform SDK llm config to TriProtocol LLMConfig format
      const protocolConfig: any = {
        name: 'tri-protocol-sdk',
        version: '1.0.0',
        persistence: this.config.persistence,
        protocols: {
          a2a: { enabled: false },
          langgraph: { enabled: false },
          mcp: { enabled: false }
        }
      };

      // Add protocol configs if provided
      if (this.config.protocols) {
        if (this.config.protocols.a2a) {
          protocolConfig.protocols.a2a = typeof this.config.protocols.a2a === 'boolean'
            ? { enabled: this.config.protocols.a2a }
            : { ...this.config.protocols.a2a, enabled: true };
        }
        if (this.config.protocols.langgraph) {
          protocolConfig.protocols.langgraph = typeof this.config.protocols.langgraph === 'boolean'
            ? { enabled: this.config.protocols.langgraph }
            : { ...this.config.protocols.langgraph, enabled: true };
        }
        if (this.config.protocols.mcp) {
          protocolConfig.protocols.mcp = typeof this.config.protocols.mcp === 'boolean'
            ? { enabled: this.config.protocols.mcp }
            : { ...this.config.protocols.mcp, enabled: true };
        }
      }

      // Transform LLM config if provided
      if (this.config.llm) {
        protocolConfig.llm = {
          defaultProvider: this.config.llm.provider || 'ollama',
          providers: [{
            type: this.config.llm.provider || 'ollama',
            enabled: true,
            apiKey: this.config.llm.apiKey,
            model: this.config.llm.model,
            endpoint: this.config.llm.endpoint,
            priority: 1
          }],
          enableCache: true,
          fallbackStrategy: 'cascade' as const,
          timeout: 30000
        };
      }

      this.protocol = new TriProtocol(protocolConfig);

      await this.protocol.initialize();

      // Initialize client
      const { TriProtocolClient } = await import('./client/TriProtocolClient');
      this.client = new TriProtocolClient(this);

      // Load default templates
      await this.loadDefaultTemplates();

      // Install plugins
      if (this.config.advanced?.plugins) {
        for (const plugin of this.config.advanced.plugins) {
          await this.registerPlugin(plugin);
        }
      }

      // Setup hooks
      if (this.config.advanced?.hooks) {
        this.setupHooks(this.config.advanced.hooks);
      }

      this.initialized = true;
      this.logger.info('Tri-Protocol SDK initialized successfully');
      this.emit('initialized');
    } catch (error) {
      this.logger.error('Failed to initialize SDK:', error);
      throw new SDKError('SDK initialization failed', 'INIT_ERROR', error);
    }
  }

  private async loadDefaultTemplates(): Promise<void> {
    // Load agent templates
    const agentTemplates = await import('./templates/agents');
    for (const [name, template] of Object.entries(agentTemplates)) {
      if (typeof template === 'object' && 'create' in template) {
        this.agentTemplates.set(name.toLowerCase(), template as AgentTemplate);
      }
    }

    // Load workflow templates
    const workflowTemplates = await import('./templates/workflows');
    for (const [name, template] of Object.entries(workflowTemplates)) {
      if (typeof template === 'object' && 'create' in template) {
        this.workflowTemplates.set(name.toLowerCase(), template as WorkflowTemplate);
      }
    }
  }

  private setupHooks(hooks: any): void {
    if (hooks.onAgentCreated) {
      this.on('agent:created', hooks.onAgentCreated);
    }
    if (hooks.onWorkflowCreated) {
      this.on('workflow:created', hooks.onWorkflowCreated);
    }
    if (hooks.onError) {
      this.on('error', hooks.onError);
    }
    if (hooks.onLLMCall) {
      this.on('llm:call', hooks.onLLMCall);
    }
  }

  async createAgent(name: string, template?: string): Promise<any> {
    await this.ensureInitialized();

    const { AgentBuilder } = await import('./builders/AgentBuilder');
    const builder = new AgentBuilder(this.protocol, this);

    builder.withName(name);

    if (template) {
      const templateObj = this.agentTemplates.get(template.toLowerCase());
      if (templateObj) {
        return templateObj.create(this);
      }
      builder.fromTemplate(template);
    }

    return builder;
  }

  async createWorkflow(name: string): Promise<any> {
    await this.ensureInitialized();

    const { WorkflowBuilder } = await import('./builders/WorkflowBuilder');
    return new WorkflowBuilder(this.protocol, this).withName(name);
  }

  async query(question: string, context?: any): Promise<any> {
    await this.ensureInitialized();

    try {
      const analysis = await this.analyzeQuery(question);
      this.logger.debug('Query analysis:', analysis);

      if (analysis.type === 'agent') {
        const agent = await this.findBestAgent(analysis.capability);
        if (agent) {
          return agent.respond(question, context);
        }
      }

      if (analysis.type === 'workflow') {
        const workflow = this.workflowTemplates.get(analysis.workflow!);
        if (workflow) {
          const wf = await workflow.create(this);
          return wf.execute({ input: question, context });
        }
      }

      // Default to LLM
      return this.client.llm.complete(question, context);
    } catch (error) {
      this.logger.error('Query failed:', error);
      this.emit('error', error);
      throw new SDKError('Query execution failed', 'QUERY_ERROR', error);
    }
  }

  private async analyzeQuery(question: string): Promise<QueryAnalysis> {
    // Simple heuristic-based analysis for now
    const lowerQuestion = question.toLowerCase();

    if (lowerQuestion.includes('analyze') || lowerQuestion.includes('data')) {
      return {
        type: 'agent',
        capability: 'analysis',
        confidence: 0.8
      };
    }

    if (lowerQuestion.includes('research') || lowerQuestion.includes('find')) {
      return {
        type: 'agent',
        capability: 'research',
        confidence: 0.7
      };
    }

    if (lowerQuestion.includes('workflow') || lowerQuestion.includes('pipeline')) {
      return {
        type: 'workflow',
        workflow: 'data-pipeline',
        confidence: 0.6
      };
    }

    return {
      type: 'llm',
      confidence: 0.5
    };
  }

  private async findBestAgent(capability?: string): Promise<SDKAgent | null> {
    const registry = this.protocol.getRegistry();
    const agents = await registry.list();

    if (!capability) {
      return agents.length > 0 ? agents[0] as any : null;
    }

    // Find agent with matching capability
    for (const agent of agents) {
      if ((agent as any).capabilities?.includes(capability)) {
        return agent as any;
      }
    }

    return null;
  }

  async chat(message: string, context?: any): Promise<string> {
    await this.ensureInitialized();

    if (!this.chatAgent) {
      this.chatAgent = await this.getOrCreateChatAgent();
    }

    return this.chatAgent.respond(message, context);
  }

  async analyze(data: any, type?: string): Promise<any> {
    await this.ensureInitialized();

    if (!this.analystAgent) {
      this.analystAgent = await this.getOrCreateAnalystAgent();
    }

    return this.analystAgent.execute({
      action: 'analyze',
      data,
      type
    });
  }

  async runWorkflow(template: string, input: any): Promise<any> {
    await this.ensureInitialized();

    const workflowTemplate = this.workflowTemplates.get(template.toLowerCase());
    if (!workflowTemplate) {
      throw new SDKError(`Workflow template '${template}' not found`, 'TEMPLATE_NOT_FOUND');
    }

    const workflow = await workflowTemplate.create(this);
    return workflow.execute(input);
  }

  private async getOrCreateChatAgent(): Promise<SDKAgent> {
    const template = this.agentTemplates.get('chatagent');
    if (template) {
      return template.create(this);
    }

    // Fallback to basic agent
    const builder = await this.createAgent('ChatAgent');
    return builder
      .withCapability('conversation')
      .withMemory('both')
      .build();
  }

  private async getOrCreateAnalystAgent(): Promise<SDKAgent> {
    const template = this.agentTemplates.get('analystagent');
    if (template) {
      return template.create(this);
    }

    // Fallback to basic agent
    const builder = await this.createAgent('AnalystAgent');
    return builder
      .withCapability('analysis')
      .withCapability('visualization')
      .build();
  }

  async getWorkflowTemplate(template: string): Promise<any> {
    return this.workflowTemplates.get(template.toLowerCase());
  }

  async executeWorkflow(workflow: any, input: any): Promise<any> {
    return workflow.execute(input);
  }

  async getWorkflowStatus(id: string): Promise<any> {
    const orchestrator = this.protocol.getOrchestrator();
    return orchestrator.getTaskStatus(id);
  }

  getProtocol(): TriProtocol {
    if (!this.protocol) {
      throw new SDKError('SDK not initialized', 'NOT_INITIALIZED');
    }
    return this.protocol;
  }

  getClient(): any {
    if (!this.client) {
      throw new SDKError('SDK not initialized', 'NOT_INITIALIZED');
    }
    return this.client;
  }

  async registerPlugin(plugin: Plugin): Promise<void> {
    if (this.plugins.has(plugin.name)) {
      this.logger.warn(`Plugin '${plugin.name}' already registered`);
      return;
    }

    try {
      await plugin.install(this);
      this.plugins.set(plugin.name, plugin);
      this.logger.info(`Plugin '${plugin.name}' installed successfully`);
      this.emit('plugin:installed', plugin);
    } catch (error) {
      this.logger.error(`Failed to install plugin '${plugin.name}':`, error);
      throw new SDKError(`Plugin installation failed: ${plugin.name}`, 'PLUGIN_ERROR', error);
    }
  }

  async registerAgentTemplate(name: string, template: AgentTemplate): Promise<void> {
    this.agentTemplates.set(name.toLowerCase(), template);
    this.emit('template:registered', { type: 'agent', name, template });
  }

  async registerWorkflowTemplate(name: string, template: WorkflowTemplate): Promise<void> {
    this.workflowTemplates.set(name.toLowerCase(), template);
    this.emit('template:registered', { type: 'workflow', name, template });
  }

  async registerAgent(AgentClass: any): Promise<SDKAgent> {
    const instance = new AgentClass(this);
    await instance.initialize();
    this.emit('agent:created', instance);
    return instance;
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  async shutdown(): Promise<void> {
    try {
      this.logger.info('Shutting down SDK...');

      // Cleanup agents
      this.chatAgent = undefined;
      this.analystAgent = undefined;

      // Shutdown protocol
      if (this.protocol) {
        await this.protocol.shutdown();
      }

      // Clear plugins
      this.plugins.clear();

      // Clear templates
      this.agentTemplates.clear();
      this.workflowTemplates.clear();

      this.initialized = false;
      this.emit('shutdown');
      this.removeAllListeners();

      this.logger.info('SDK shutdown complete');
    } catch (error) {
      this.logger.error('Error during shutdown:', error);
      throw new SDKError('Shutdown failed', 'SHUTDOWN_ERROR', error);
    }
  }

  getConfig(): SDKConfig {
    return { ...this.config };
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  getPlugins(): Plugin[] {
    return Array.from(this.plugins.values());
  }

  getAgentTemplates(): string[] {
    return Array.from(this.agentTemplates.keys());
  }

  getWorkflowTemplates(): string[] {
    return Array.from(this.workflowTemplates.keys());
  }
}