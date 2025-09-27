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
import { SDKMetrics, SDKMetricsConfig, MetricSnapshot } from './metrics';

export class TriProtocolSDK extends EventEmitter {
  private static instances: Map<string, TriProtocolSDK> = new Map();
  private protocol!: TriProtocol;
  private client!: any;
  private config: SDKConfig;
  private metrics: SDKMetrics;
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

    // Initialize metrics system
    const metricsConfig: SDKMetricsConfig = {
      enabled: config.metrics?.enabled !== false,
      collectInterval: config.metrics?.collectInterval || 60000,
      persistence: config.metrics?.persistence || 'memory',
      exporters: config.metrics?.exporters || []
    };
    this.metrics = new SDKMetrics(metricsConfig);
  }

  static create(name: string = 'default', config?: SDKConfig): TriProtocolSDK {
    // Create a safe key without circular references
    const configKey = config ? this.createConfigKey(config) : 'default';
    const key = `${name}-${configKey}`;

    if (!TriProtocolSDK.instances.has(key)) {
      const instance = new TriProtocolSDK(config);
      TriProtocolSDK.instances.set(key, instance);
    }

    return TriProtocolSDK.instances.get(key)!;
  }

  private static createConfigKey(config: SDKConfig): string {
    // Create a simple key from main config properties
    const keyParts = [
      config.mode || 'dev',
      config.persistence?.backend || 'mem',
      config.llm?.provider || 'default',
      config.metrics?.enabled ? 'metrics' : 'no-metrics'
    ];
    return keyParts.join('-');
  }

  static async initialize(name: string = 'default', config?: SDKConfig): Promise<TriProtocolSDK> {
    const sdk = TriProtocolSDK.create(name, config);
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

      // Instrument SDK operations for metrics
      this.instrumentOperations();

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

  /**
   * Instrument SDK operations with metrics collection
   */
  private instrumentOperations(): void {
    // Track protocol usage
    if (this.protocol) {
      const originalA2AEnabled = this.config.protocols?.a2a;
      const originalMCPEnabled = this.config.protocols?.mcp;
      const originalLangGraphEnabled = this.config.protocols?.langgraph;

      if (originalA2AEnabled) {
        this.on('protocol:a2a:used', () => {
          this.metrics.incrementCounter('protocol.a2a');
        });
      }

      if (originalMCPEnabled) {
        this.on('protocol:mcp:used', () => {
          this.metrics.incrementCounter('protocol.mcp');
        });
      }

      if (originalLangGraphEnabled) {
        this.on('protocol:langgraph:used', () => {
          this.metrics.incrementCounter('protocol.langgraph');
        });
      }
    }

    // Track LLM usage
    this.on('llm:call', (data: any) => {
      if (data.provider) {
        this.metrics.recordLLMCall(
          data.provider,
          data.tokens || 0,
          data.cached || false,
          data.cost
        );
      }
    });
  }

  async createAgent(name: string, template?: string): Promise<any> {
    await this.ensureInitialized();

    const timer = this.metrics.startTimer('agent.create');
    this.metrics.incrementCounter('agents.created');
    this.metrics.incrementCounter('builders.agent');

    try {
      const { AgentBuilder } = await import('./builders/AgentBuilder');
      const builder = new AgentBuilder(this.protocol, this);

      builder.withName(name);

      if (template) {
        this.metrics.incrementCounter('builders.fromTemplate');
        const templateObj = this.agentTemplates.get(template.toLowerCase());
        if (templateObj) {
          const agent = await templateObj.create(this);
          this.metrics.endTimer(timer);
          this.metrics.setGauge('agents.active',
            (this.metrics.getSnapshot().activeAgents || 0) + 1
          );
          return agent;
        }
        builder.fromTemplate(template);
      } else {
        this.metrics.incrementCounter('builders.fromScratch');
      }

      // Wrap builder's build method to track metrics
      const originalBuild = builder.build.bind(builder);
      builder.build = async () => {
        const agent = await originalBuild();
        this.metrics.setGauge('agents.active',
          (this.metrics.getSnapshot().activeAgents || 0) + 1
        );
        return agent;
      };

      this.metrics.endTimer(timer);
      return builder;
    } catch (error) {
      this.metrics.endTimer(timer);
      this.metrics.recordError(error as Error, { name, template });
      throw error;
    }
  }

  async createWorkflow(name: string): Promise<any> {
    await this.ensureInitialized();

    const timer = this.metrics.startTimer('workflow.create');
    this.metrics.incrementCounter('builders.workflow');

    try {
      const { WorkflowBuilder } = await import('./builders/WorkflowBuilder');
      const builder = new WorkflowBuilder(this.protocol, this).withName(name);

      // Wrap builder's build method to track metrics
      const originalBuild = builder.build.bind(builder);
      builder.build = async () => {
        const workflow = await originalBuild();
        this.metrics.setGauge('workflows.active',
          (this.metrics.getSnapshot().activeWorkflows || 0) + 1
        );
        return workflow;
      };

      this.metrics.endTimer(timer);
      return builder;
    } catch (error) {
      this.metrics.endTimer(timer);
      this.metrics.recordError(error as Error, { name });
      throw error;
    }
  }

  async query(question: string, context?: any): Promise<any> {
    await this.ensureInitialized();

    const timer = this.metrics.startTimer('query');
    this.metrics.incrementCounter('queries.total');

    try {
      const analysis = await this.analyzeQuery(question);
      this.logger.debug('Query analysis:', analysis);

      let result;
      if (analysis.type === 'agent') {
        const agent = await this.findBestAgent(analysis.capability);
        if (agent) {
          result = await agent.respond(question, context);
        }
      }

      if (!result && analysis.type === 'workflow') {
        const workflow = this.workflowTemplates.get(analysis.workflow!);
        if (workflow) {
          const wf = await workflow.create(this);
          result = await wf.execute({ input: question, context });
        }
      }

      if (!result) {
        // Default to LLM
        result = await this.client.llm.complete(question, context);
      }

      this.metrics.endTimer(timer);
      return result;
    } catch (error) {
      this.metrics.endTimer(timer);
      this.metrics.recordError(error as Error, { question, context });
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

    const timer = this.metrics.startTimer('workflow.execute');
    this.metrics.incrementCounter('workflows.executed');
    this.metrics.setGauge('workflows.active',
      (this.metrics.getSnapshot().activeWorkflows || 0) + 1
    );

    try {
      const workflowTemplate = this.workflowTemplates.get(template.toLowerCase());
      if (!workflowTemplate) {
        throw new SDKError(`Workflow template '${template}' not found`, 'TEMPLATE_NOT_FOUND');
      }

      const workflow = await workflowTemplate.create(this);
      const result = await workflow.execute(input);

      this.metrics.endTimer(timer);
      this.metrics.setGauge('workflows.active',
        Math.max(0, (this.metrics.getSnapshot().activeWorkflows || 1) - 1)
      );
      return result;
    } catch (error) {
      this.metrics.endTimer(timer);
      this.metrics.setGauge('workflows.active',
        Math.max(0, (this.metrics.getSnapshot().activeWorkflows || 1) - 1)
      );
      this.metrics.recordError(error as Error, { template, input });
      throw error;
    }
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

      // Stop metrics collection
      this.metrics.stop();

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

  /**
   * Get the metrics collector instance
   */
  getMetrics(): SDKMetrics {
    return this.metrics;
  }

  /**
   * Get current metrics snapshot
   */
  getMetricsSnapshot(): MetricSnapshot {
    return this.metrics.getSnapshot();
  }

  /**
   * Enable metrics export with a specific exporter
   */
  enableMetricsExport(exporter: any): void {
    this.metrics.addExporter(exporter);
  }

  /**
   * Clear all singleton instances (for testing)
   */
  static clearInstances(): void {
    TriProtocolSDK.instances.clear();
  }
}