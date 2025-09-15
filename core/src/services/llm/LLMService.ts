/**
 * LLM Service
 * Main service for managing multiple LLM providers with fallback, caching, and rate limiting
 */

import { EventEmitter } from 'eventemitter3';
import { Logger } from '@tri-protocol/logger';
import {
  LLMProviderType,
  LLMConfig,
  ProviderConfig,
  CompletionOptions,
  LLMResponse,
  ChatMessage,
  LLMError,
  ProviderUnavailableError,
  LLMServiceStatus,
  EmbeddingOptions,
  EmbeddingResponse,
  StreamOptions
} from './types';
import {
  BaseProvider,
  OllamaProvider,
  OpenAIProvider,
  AnthropicProvider,
  GeminiProvider,
  HuggingFaceProvider,
  MistralProvider
} from './providers';
import { LLMCache } from './support/LLMCache';
import { RateLimiter } from './support/RateLimiter';
import { LLMMetrics } from './support/LLMMetrics';

export class LLMService extends EventEmitter {
  private providers = new Map<LLMProviderType, BaseProvider>();
  private defaultProvider: LLMProviderType = 'ollama';
  private fallbackStrategy: 'cascade' | 'random' | 'loadbalance';
  private cache?: LLMCache;
  private rateLimiter: RateLimiter;
  private metrics: LLMMetrics;
  private logger: Logger;
  private isInitialized = false;
  private providerPriorities: LLMProviderType[] = [];
  private retryAttempts: number;
  private timeout: number;

  constructor(private config: LLMConfig) {
    super();
    this.logger = Logger.getLogger('LLMService');
    this.defaultProvider = config.defaultProvider || 'ollama';
    this.fallbackStrategy = config.fallbackStrategy || 'cascade';
    this.retryAttempts = config.retryAttempts || 3;
    this.timeout = config.timeout || 30000;
    
    // Initialize components
    this.metrics = new LLMMetrics();
    this.rateLimiter = new RateLimiter(config.rateLimits);
    
    // Setup cache if enabled
    if (config.enableCache) {
      this.setupCache(config);
    }
    
    // Initialize providers
    this.initializeProviders(config.providers);
    
    // Setup event listeners
    this.setupEventListeners();
    
    this.logger.info('LLM Service initialized', {
      defaultProvider: this.defaultProvider,
      providers: Array.from(this.providers.keys()),
      cacheEnabled: !!this.cache,
      fallbackStrategy: this.fallbackStrategy
    });
  }

  /**
   * Initialize providers
   */
  private initializeProviders(configs: ProviderConfig[]): void {
    // Sort by priority for fallback
    const sorted = configs
      .filter(c => c.enabled)
      .sort((a, b) => (a.priority || 999) - (b.priority || 999));
    
    for (const config of sorted) {
      try {
        const provider = this.createProvider(config);
        if (provider) {
          this.providers.set(config.type, provider);
          this.providerPriorities.push(config.type);
          
          this.logger.info('Provider initialized', { 
            type: config.type, 
            priority: config.priority 
          });
        }
      } catch (error) {
        this.logger.error('Failed to initialize provider', {
          type: config.type,
          error: (error as Error).message
        });
      }
    }
    
    // Ensure Ollama is available as default if not already configured
    if (!this.providers.has('ollama')) {
      try {
        const ollamaProvider = new OllamaProvider({
          type: 'ollama',
          enabled: true,
          endpoint: 'http://localhost:11434'
        });
        this.providers.set('ollama', ollamaProvider);
        this.providerPriorities.push('ollama');
        
        this.logger.info('Default Ollama provider added');
      } catch (error) {
        this.logger.warn('Failed to add default Ollama provider', {
          error: (error as Error).message
        });
      }
    }
    
    this.isInitialized = true;
  }

  /**
   * Create provider instance
   */
  private createProvider(config: ProviderConfig): BaseProvider | null {
    if (!config.enabled) {
      return null;
    }
    
    switch (config.type) {
      case 'ollama':
        return new OllamaProvider(config);
      case 'openai':
        return new OpenAIProvider(config);
      case 'anthropic':
        return new AnthropicProvider(config);
      case 'gemini':
        return new GeminiProvider(config);
      case 'huggingface':
        return new HuggingFaceProvider(config);
      case 'mistral':
        return new MistralProvider(config);
      default:
        this.logger.warn('Unknown provider type', { type: config.type });
        return null;
    }
  }

  /**
   * Setup cache
   */
  private setupCache(config: LLMConfig): void {
    this.cache = new LLMCache(config.cacheConfig);
    
    // Listen to cache events
    this.cache.on('hit', (data) => {
      this.emit('cache:hit', data);
      this.logger.debug('Cache hit', { key: data.key });
    });
    
    this.cache.on('miss', (data) => {
      this.emit('cache:miss', data);
    });
    
    this.logger.info('Cache enabled', config.cacheConfig);
  }

  /**
   * Setup event listeners
   */
  private setupEventListeners(): void {
    // Metrics events
    this.metrics.on('metric', (data) => {
      this.emit('metric', data);
    });
    
    // Rate limiter events
    this.rateLimiter.on('acquired', (data) => {
      this.emit('ratelimit:acquired', data);
    });
    
    this.rateLimiter.on('concurrent_limit', (data) => {
      this.emit('ratelimit:concurrent', data);
    });
  }

  /**
   * Main completion method with fallback
   */
  async complete(prompt: string, options?: CompletionOptions): Promise<LLMResponse> {
    const startTime = Date.now();
    
    // Check cache first
    if (this.cache && options?.useCache !== false) {
      const cached = await this.cache.get(prompt, options);
      if (cached) {
        this.emit('cache:hit', { prompt, options });
        return { ...cached, cached: true };
      }
    }
    
    // Select provider based on strategy
    const primaryProvider = options?.provider || this.selectProvider();
    
    try {
      // Acquire rate limit
      await this.rateLimiter.acquire(primaryProvider);
      
      const response = await this.executeWithProvider(primaryProvider, prompt, options);
      
      // Release rate limit
      this.rateLimiter.release(primaryProvider);
      
      // Cache successful response
      if (this.cache && options?.useCache !== false) {
        await this.cache.set(prompt, options, response);
      }
      
      // Record metrics
      this.metrics.recordCompletion(
        primaryProvider,
        Date.now() - startTime,
        true,
        response.usage ? {
          prompt: response.usage.promptTokens,
          completion: response.usage.completionTokens,
          total: response.usage.totalTokens
        } : undefined
      );
      
      return response;
      
    } catch (error) {
      // Release rate limit on error
      this.rateLimiter.release(primaryProvider);
      
      // Record failure
      this.metrics.recordCompletion(
        primaryProvider,
        Date.now() - startTime,
        false,
        undefined,
        (error as Error).message
      );
      
      this.logger.warn('Primary provider failed, trying fallback', {
        provider: primaryProvider,
        error: (error as Error).message
      });
      
      // Try fallback
      return this.executeFallback(prompt, options, primaryProvider);
    }
  }

  /**
   * Chat completion
   */
  async chat(messages: ChatMessage[], options?: CompletionOptions): Promise<LLMResponse> {
    const provider = this.selectProvider(options?.provider);
    const providerInstance = this.providers.get(provider);
    
    if (!providerInstance) {
      throw new ProviderUnavailableError(provider);
    }
    
    // Use provider's chat method
    return this.executeProviderMethod(
      provider,
      async () => providerInstance.chat(messages, options)
    );
  }

  /**
   * Generate embeddings
   */
  async embed(text: string, options?: EmbeddingOptions): Promise<EmbeddingResponse> {
    const provider = this.selectProvider(options?.provider);
    const providerInstance = this.providers.get(provider);
    
    if (!providerInstance) {
      throw new ProviderUnavailableError(provider);
    }
    
    if (!providerInstance.supports('embeddings')) {
      throw new LLMError(`Provider ${provider} does not support embeddings`, provider);
    }
    
    return this.executeProviderMethod(
      provider,
      async () => providerInstance.embed(text, options)
    );
  }

  /**
   * Stream completion
   */
  async stream(
    prompt: string,
    onChunk: (chunk: string) => void,
    options?: StreamOptions
  ): Promise<void> {
    const provider = this.selectProvider(options?.provider);
    const providerInstance = this.providers.get(provider);
    
    if (!providerInstance) {
      throw new ProviderUnavailableError(provider);
    }
    
    if (!providerInstance.supports('streaming')) {
      // Fallback to non-streaming
      const response = await this.complete(prompt, options);
      onChunk(response.content);
      if (options?.onComplete) {
        options.onComplete(response);
      }
      return;
    }
    
    return this.executeProviderMethod(
      provider,
      async () => providerInstance.stream(prompt, onChunk, options)
    );
  }

  /**
   * Execute with specific provider
   */
  private async executeWithProvider(
    providerType: LLMProviderType,
    prompt: string,
    options?: CompletionOptions
  ): Promise<LLMResponse> {
    const provider = this.providers.get(providerType);
    
    if (!provider) {
      throw new ProviderUnavailableError(providerType);
    }
    
    if (!provider.isAvailable()) {
      throw new ProviderUnavailableError(providerType, 'Provider not available');
    }
    
    return provider.complete(prompt, options);
  }

  /**
   * Execute provider method with error handling
   */
  private async executeProviderMethod<T>(
    providerType: LLMProviderType,
    method: () => Promise<T>
  ): Promise<T> {
    const startTime = Date.now();
    
    try {
      await this.rateLimiter.acquire(providerType);
      const result = await method();
      this.rateLimiter.release(providerType);
      
      this.metrics.recordCompletion(
        providerType,
        Date.now() - startTime,
        true
      );
      
      return result;
    } catch (error) {
      this.rateLimiter.release(providerType);
      
      this.metrics.recordCompletion(
        providerType,
        Date.now() - startTime,
        false,
        undefined,
        (error as Error).message
      );
      
      throw error;
    }
  }

  /**
   * Execute fallback strategy
   */
  private async executeFallback(
    prompt: string,
    options: CompletionOptions | undefined,
    failedProvider: LLMProviderType
  ): Promise<LLMResponse> {
    const availableProviders = this.getAvailableProviders(failedProvider);
    
    if (availableProviders.length === 0) {
      throw new LLMError('All LLM providers failed');
    }
    
    // Try fallback providers based on strategy
    if (this.fallbackStrategy === 'random') {
      const randomProvider = availableProviders[
        Math.floor(Math.random() * availableProviders.length)
      ];
      return this.executeWithProvider(randomProvider, prompt, options);
    }
    
    // Cascade or loadbalance strategy
    for (const providerType of availableProviders) {
      try {
        this.logger.info('Trying fallback provider', { provider: providerType });
        
        await this.rateLimiter.acquire(providerType);
        const response = await this.executeWithProvider(providerType, prompt, options);
        this.rateLimiter.release(providerType);
        
        return response;
      } catch (error) {
        this.rateLimiter.release(providerType);
        
        this.logger.warn('Fallback provider failed', {
          provider: providerType,
          error: (error as Error).message
        });
        continue;
      }
    }
    
    throw new LLMError('All LLM providers failed');
  }

  /**
   * Select provider based on strategy
   */
  private selectProvider(preferred?: LLMProviderType): LLMProviderType {
    if (preferred && this.providers.has(preferred)) {
      return preferred;
    }
    
    if (this.fallbackStrategy === 'loadbalance') {
      // Select provider with best metrics
      const rankings = this.metrics.getProviderRankings();
      if (rankings.length > 0) {
        return rankings[0].provider;
      }
    }
    
    return this.defaultProvider;
  }

  /**
   * Get available providers
   */
  private getAvailableProviders(exclude?: LLMProviderType): LLMProviderType[] {
    return this.providerPriorities.filter(p => {
      if (p === exclude) return false;
      const provider = this.providers.get(p);
      return provider && provider.isAvailable();
    });
  }

  /**
   * Get service status
   */
  getStatus(): LLMServiceStatus {
    const providerStatuses = Array.from(this.providers.entries()).map(([type, provider]) => ({
      type,
      available: provider.isAvailable(),
      metrics: this.metrics.getProviderMetrics(type) || undefined
    }));
    
    return {
      providers: providerStatuses,
      defaultProvider: this.defaultProvider,
      cacheStats: this.cache?.getStats(),
      totalRequests: this.metrics.getTotalRequests()
    };
  }

  /**
   * Get provider instance
   */
  getProvider(type: LLMProviderType): BaseProvider | undefined {
    return this.providers.get(type);
  }

  /**
   * Check if provider is available
   */
  hasProvider(type: LLMProviderType): boolean {
    const provider = this.providers.get(type);
    return provider ? provider.isAvailable() : false;
  }

  /**
   * Get metrics
   */
  getMetrics(): LLMMetrics {
    return this.metrics;
  }

  /**
   * Get cache
   */
  getCache(): LLMCache | undefined {
    return this.cache;
  }

  /**
   * Stop the service
   */
  async stop(): Promise<void> {
    this.logger.info('Stopping LLM Service');
    
    // Stop cache
    if (this.cache) {
      this.cache.stop();
    }
    
    // Stop rate limiter
    this.rateLimiter.stop();
    
    // Clear providers
    this.providers.clear();
    
    // Remove listeners
    this.removeAllListeners();
    
    this.logger.info('LLM Service stopped');
  }
}