/**
 * LLM Service Types & Interfaces
 * Core types for the Tri-Protocol LLM Service
 */

// Provider types
export type LLMProviderType = 'ollama' | 'openai' | 'anthropic' | 'gemini' | 'huggingface' | 'mistral';

// Configuration interfaces
export interface LLMConfig {
  providers: ProviderConfig[];
  defaultProvider: LLMProviderType;
  fallbackStrategy?: 'cascade' | 'random' | 'loadbalance';
  enableCache?: boolean;
  cacheConfig?: CacheConfig;
  rateLimits?: Record<LLMProviderType, RateLimitConfig>;
  timeout?: number;
  retryAttempts?: number;
}

export interface ProviderConfig {
  type: LLMProviderType;
  enabled: boolean;
  endpoint?: string;
  apiKey?: string;
  model?: string;
  priority?: number; // For fallback ordering
  maxTokens?: number;
  temperature?: number;
  timeout?: number; // Request timeout in milliseconds
}

// Cache configuration
export interface CacheConfig {
  ttl?: number; // Time to live in milliseconds
  maxSize?: number; // Maximum cache size
  strategy?: 'lru' | 'fifo'; // Cache eviction strategy
}

// Rate limiting configuration
export interface RateLimitConfig {
  rpm?: number; // Requests per minute
  tpm?: number; // Tokens per minute
  concurrent?: number; // Max concurrent requests
}

// Request/Response types
export interface CompletionOptions {
  provider?: LLMProviderType;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  topK?: number;
  systemPrompt?: string;
  format?: 'text' | 'json';
  useCache?: boolean;
  stream?: boolean;
  timeout?: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'function';
  content: string;
  name?: string; // For function messages
}

export interface LLMResponse {
  content: string;
  provider: LLMProviderType;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  cached?: boolean;
  latency?: number;
  finishReason?: 'stop' | 'length' | 'error';
}

// Streaming types
export interface StreamOptions extends CompletionOptions {
  onToken?: (token: string) => void;
  onComplete?: (response: LLMResponse) => void;
  onError?: (error: Error) => void;
}

// Embedding types
export interface EmbeddingOptions {
  provider?: LLMProviderType;
  model?: string;
  dimensions?: number;
}

export interface EmbeddingResponse {
  embedding: number[];
  provider: LLMProviderType;
  model: string;
  dimensions: number;
}

// Provider capabilities
export interface ProviderCapabilities {
  chat: boolean;
  completion: boolean;
  streaming: boolean;
  embeddings: boolean;
  functionCalling: boolean;
  jsonMode: boolean;
  vision: boolean;
}

// Error types
export class LLMError extends Error {
  constructor(
    message: string,
    public provider?: LLMProviderType,
    public code?: string,
    public statusCode?: number
  ) {
    super(message);
    this.name = 'LLMError';
  }
}

export class RateLimitError extends LLMError {
  constructor(
    provider: LLMProviderType,
    public retryAfter?: number
  ) {
    super(`Rate limit exceeded for provider: ${provider}`, provider, 'RATE_LIMIT', 429);
    this.name = 'RateLimitError';
  }
}

export class ProviderUnavailableError extends LLMError {
  constructor(provider: LLMProviderType, reason?: string) {
    super(
      `Provider ${provider} is unavailable${reason ? `: ${reason}` : ''}`,
      provider,
      'PROVIDER_UNAVAILABLE',
      503
    );
    this.name = 'ProviderUnavailableError';
  }
}

// Metrics types
export interface LLMMetrics {
  provider: LLMProviderType;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageLatency: number;
  totalTokens: number;
  cacheHits: number;
  cacheMisses: number;
}

// Service status
export interface LLMServiceStatus {
  providers: ProviderStatus[];
  defaultProvider: LLMProviderType;
  cacheStats?: CacheStats;
  totalRequests: number;
}

export interface ProviderStatus {
  type: LLMProviderType;
  available: boolean;
  metrics?: LLMMetrics;
  lastError?: string;
  lastChecked?: Date;
}

export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  evictions: number;
}

// Reasoning types
export interface ReasoningStep {
  type: 'understand' | 'decompose' | 'plan' | 'execute' | 'evaluate';
  content: string;
  confidence?: number;
}

export interface ReasoningChain {
  steps: ReasoningStep[];
  conclusion?: string;
  confidence?: number;
}

// Token counting
export interface TokenCounter {
  count(text: string, model?: string): number;
  countMessages(messages: ChatMessage[], model?: string): number;
}

// Cache entry
export interface CacheEntry {
  response: LLMResponse;
  timestamp: number;
  hits?: number;
}