import { SDKError } from '../types';

export class Validators {
  /**
   * Validate agent name
   */
  static validateAgentName(name: string): void {
    // Handle null/undefined and trimming
    if (name === null || name === undefined) {
      throw new SDKError('Agent name cannot be null', 'VALIDATION_ERROR');
    }

    // Trim whitespace
    const trimmedName = name.toString().trim();

    if (!trimmedName || typeof trimmedName !== 'string') {
      throw new SDKError('Agent name cannot be empty', 'VALIDATION_ERROR');
    }

    if (trimmedName.length > 100) {
      throw new SDKError('Agent name must be less than 100 characters', 'VALIDATION_ERROR');
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(trimmedName)) {
      throw new SDKError(
        'Agent name can only contain alphanumeric characters, underscores, and hyphens',
        'VALIDATION_ERROR'
      );
    }
  }

  /**
   * Validate workflow name
   */
  static validateWorkflowName(name: string): void {
    if (!name || typeof name !== 'string') {
      throw new SDKError('Workflow name must be a non-empty string', 'VALIDATION_ERROR');
    }

    if (name.length < 2) {
      throw new SDKError('Workflow name must be at least 2 characters long', 'VALIDATION_ERROR');
    }

    if (name.length > 50) {
      throw new SDKError('Workflow name must be at most 50 characters long', 'VALIDATION_ERROR');
    }

    // Reject workflow names with invalid characters (spaces, special chars)
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      throw new SDKError(
        'Workflow name can only contain alphanumeric characters, underscores, and hyphens',
        'VALIDATION_ERROR'
      );
    }
  }

  /**
   * Validate capability
   */
  static validateCapability(capability: string): void {
    if (capability === null || capability === undefined) {
      throw new SDKError('Capability cannot be empty', 'VALIDATION_ERROR');
    }

    if (!capability || typeof capability !== 'string') {
      throw new SDKError('Capability cannot be empty', 'VALIDATION_ERROR');
    }

    const validCapabilities = [
      'conversation',
      'research',
      'analysis',
      'data-analysis',
      'visualization',
      'code-generation',
      'debugging',
      'task-planning',
      'problem-solving',
      'content-generation',
      'fact-checking',
      'summarization',
      'translation',
      'general-assistance'
    ];

    if (!validCapabilities.includes(capability) && !capability.startsWith('custom:')) {
      throw new SDKError(
        `Invalid capability: ${capability}. Use a standard capability or prefix custom capabilities with 'custom:'`,
        'VALIDATION_ERROR'
      );
    }
  }

  /**
   * Validate LLM provider
   */
  static validateLLMProvider(provider: string): void {
    const validProviders = [
      'ollama',
      'openai',
      'anthropic',
      'gemini',
      'mistral',
      'huggingface'
    ];

    // Case-insensitive check
    const lowerProvider = provider.toLowerCase();
    if (!validProviders.includes(lowerProvider)) {
      throw new SDKError(
        `Invalid LLM provider: ${provider}. Valid providers: ${validProviders.join(', ')}`,
        'VALIDATION_ERROR'
      );
    }
  }

  /**
   * Validate API key
   */
  static validateAPIKey(key: string, provider: string): void {
    if (!key || typeof key !== 'string') {
      throw new SDKError(`API key is required for provider: ${provider}`, 'VALIDATION_ERROR');
    }

    // Provider-specific validation
    switch (provider) {
      case 'openai':
        if (!key.startsWith('sk-')) {
          throw new SDKError('OpenAI API key should start with "sk-"', 'VALIDATION_ERROR');
        }
        break;
      case 'anthropic':
        if (!key.startsWith('sk-ant-')) {
          throw new SDKError('Anthropic API key should start with "sk-ant-"', 'VALIDATION_ERROR');
        }
        break;
      // Add more provider-specific validations as needed
    }
  }

  /**
   * Validate memory configuration
   */
  static validateMemoryConfig(config: any): void {
    if (!config || typeof config !== 'object') {
      throw new SDKError('Memory configuration must be an object', 'VALIDATION_ERROR');
    }

    if (config.type && !['short', 'long', 'both'].includes(config.type)) {
      throw new SDKError(
        'Memory type must be "short", "long", or "both"',
        'VALIDATION_ERROR'
      );
    }

    if (config.ttl && (typeof config.ttl !== 'number' || config.ttl <= 0)) {
      throw new SDKError('Memory TTL must be a positive number', 'VALIDATION_ERROR');
    }

    if (config.maxEntries && (typeof config.maxEntries !== 'number' || config.maxEntries <= 0)) {
      throw new SDKError('Max entries must be a positive number', 'VALIDATION_ERROR');
    }
  }

  /**
   * Validate SDK configuration
   */
  static validateSDKConfig(config: any): void {
    if (config.mode && !['development', 'production'].includes(config.mode)) {
      throw new SDKError(
        'Mode must be either "development" or "production"',
        'VALIDATION_ERROR'
      );
    }

    if (config.persistence?.backend) {
      const validBackends = ['memory', 'file', 'mongodb', 'postgres', 'redis', 'cloud'];
      if (!validBackends.includes(config.persistence.backend)) {
        throw new SDKError(
          `Invalid persistence backend: ${config.persistence.backend}`,
          'VALIDATION_ERROR'
        );
      }
    }

    if (config.llm?.provider) {
      this.validateLLMProvider(config.llm.provider);
    }

    if (config.llm?.temperature !== undefined) {
      const temp = config.llm.temperature;
      if (typeof temp !== 'number' || temp < 0 || temp > 2) {
        throw new SDKError('Temperature must be a number between 0 and 2', 'VALIDATION_ERROR');
      }
    }

    if (config.llm?.maxTokens !== undefined) {
      const tokens = config.llm.maxTokens;
      if (typeof tokens !== 'number' || tokens <= 0) {
        throw new SDKError('Max tokens must be a positive number', 'VALIDATION_ERROR');
      }
    }
  }

  /**
   * Validate tool definition
   */
  static validateToolDefinition(tool: any): void {
    if (!tool || typeof tool !== 'object') {
      throw new SDKError('Tool definition must be an object', 'VALIDATION_ERROR');
    }

    if (!tool.name || typeof tool.name !== 'string') {
      throw new SDKError('Tool must have a name', 'VALIDATION_ERROR');
    }

    if (tool.parameters && typeof tool.parameters !== 'object') {
      throw new SDKError('Tool parameters must be an object', 'VALIDATION_ERROR');
    }

    if (tool.handler && typeof tool.handler !== 'function') {
      throw new SDKError('Tool handler must be a function', 'VALIDATION_ERROR');
    }
  }

  /**
   * Validate workflow node
   */
  static validateWorkflowNode(node: any): void {
    if (!node || typeof node !== 'object') {
      throw new SDKError('Workflow node must be an object', 'VALIDATION_ERROR');
    }

    if (!node.id || typeof node.id !== 'string') {
      throw new SDKError('Workflow node must have an id', 'VALIDATION_ERROR');
    }

    if (!node.type || typeof node.type !== 'string') {
      throw new SDKError('Workflow node must have a type', 'VALIDATION_ERROR');
    }

    const validTypes = [
      'task',
      'agent',
      'tool',
      'condition',
      'parallel-start',
      'parallel-end',
      'loop-start',
      'loop-end'
    ];

    if (!validTypes.includes(node.type)) {
      throw new SDKError(
        `Invalid node type: ${node.type}. Valid types: ${validTypes.join(', ')}`,
        'VALIDATION_ERROR'
      );
    }
  }

  /**
   * Validate workflow edge
   */
  static validateWorkflowEdge(edge: any): void {
    if (!edge || typeof edge !== 'object') {
      throw new SDKError('Workflow edge must be an object', 'VALIDATION_ERROR');
    }

    if (!edge.from || typeof edge.from !== 'string') {
      throw new SDKError('Workflow edge must have a "from" node id', 'VALIDATION_ERROR');
    }

    if (!edge.to || typeof edge.to !== 'string') {
      throw new SDKError('Workflow edge must have a "to" node id', 'VALIDATION_ERROR');
    }

    if (edge.type && !['sequential', 'conditional', 'loop'].includes(edge.type)) {
      throw new SDKError(
        'Edge type must be "sequential", "conditional", or "loop"',
        'VALIDATION_ERROR'
      );
    }
  }

  /**
   * Validate query
   */
  static validateQuery(query: string): void {
    if (!query || typeof query !== 'string') {
      throw new SDKError('Query must be a non-empty string', 'VALIDATION_ERROR');
    }

    // Reject queries that are too short
    if (query.length < 2) {
      throw new SDKError('Query must be at least 2 characters', 'VALIDATION_ERROR');
    }

    if (query.length > 10000) {
      throw new SDKError('Query is too long (max 10000 characters)', 'VALIDATION_ERROR');
    }
  }

  /**
   * Validate plugin
   */
  static validatePlugin(plugin: any): void {
    if (!plugin || typeof plugin !== 'object') {
      throw new SDKError('Plugin must be an object', 'VALIDATION_ERROR');
    }

    if (!plugin.name || typeof plugin.name !== 'string') {
      throw new SDKError('Plugin must have a name', 'VALIDATION_ERROR');
    }

    if (!plugin.install || typeof plugin.install !== 'function') {
      throw new SDKError('Plugin must have an install function', 'VALIDATION_ERROR');
    }
  }
}