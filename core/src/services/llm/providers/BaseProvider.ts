/**
 * Base Provider Abstract Class
 * Foundation for all LLM provider implementations
 */

import { EventEmitter } from 'eventemitter3';
import { Logger } from '@tri-protocol/logger';
import {
  LLMProviderType,
  ProviderConfig,
  CompletionOptions,
  LLMResponse,
  ChatMessage,
  ProviderCapabilities,
  LLMError,
  EmbeddingOptions,
  EmbeddingResponse,
  StreamOptions
} from '../types';

export abstract class BaseProvider extends EventEmitter {
  abstract name: LLMProviderType;
  protected config: ProviderConfig;
  protected logger: Logger;
  protected available: boolean = false;
  protected capabilities: ProviderCapabilities = {
    chat: false,
    completion: true,
    streaming: false,
    embeddings: false,
    functionCalling: false,
    jsonMode: false,
    vision: false
  };

  constructor(config: ProviderConfig) {
    super();
    this.config = config;
    this.logger = Logger.getLogger(`LLMProvider:${config.type}`);
    
    // Delay initialization to allow child class to set properties
    setTimeout(() => {
      this.initialize().catch(error => {
        this.logger.error('Provider initialization failed', { error: error.message });
        this.available = false;
      });
    }, 0);
  }

  /**
   * Initialize the provider (check availability, load models, etc.)
   */
  abstract initialize(): Promise<void>;

  /**
   * Complete a prompt
   */
  abstract complete(prompt: string, options?: CompletionOptions): Promise<LLMResponse>;

  /**
   * Chat completion (optional - can fallback to complete)
   */
  async chat(messages: ChatMessage[], options?: CompletionOptions): Promise<LLMResponse> {
    if (!this.capabilities.chat) {
      // Fallback to completion with formatted prompt
      const prompt = this.formatChatAsPrompt(messages, options?.systemPrompt);
      return this.complete(prompt, options);
    }
    
    // To be overridden by providers that support chat
    throw new LLMError('Chat not implemented for this provider', this.name);
  }

  /**
   * Stream completion (optional)
   */
  async stream(
    prompt: string,
    onChunk: (chunk: string) => void,
    options?: StreamOptions
  ): Promise<void> {
    if (!this.capabilities.streaming) {
      // Fallback to non-streaming
      const response = await this.complete(prompt, options);
      onChunk(response.content);
      if (options?.onComplete) {
        options.onComplete(response);
      }
      return;
    }
    
    // To be overridden by providers that support streaming
    throw new LLMError('Streaming not implemented for this provider', this.name);
  }

  /**
   * Generate embeddings (optional)
   */
  async embed(text: string, options?: EmbeddingOptions): Promise<EmbeddingResponse> {
    if (!this.capabilities.embeddings) {
      throw new LLMError('Embeddings not supported by this provider', this.name);
    }
    
    // To be overridden by providers that support embeddings
    throw new LLMError('Embeddings not implemented for this provider', this.name);
  }

  /**
   * Check if provider is available
   */
  isAvailable(): boolean {
    return this.available && this.config.enabled;
  }

  /**
   * Get provider capabilities
   */
  getCapabilities(): ProviderCapabilities {
    return { ...this.capabilities };
  }

  /**
   * Check if provider supports a specific capability
   */
  supports(capability: keyof ProviderCapabilities): boolean {
    return this.capabilities[capability] === true;
  }

  /**
   * Format chat messages as a single prompt
   */
  protected formatChatAsPrompt(messages: ChatMessage[], systemPrompt?: string): string {
    let prompt = '';
    
    // Add system prompt if provided
    if (systemPrompt) {
      prompt += `System: ${systemPrompt}\n\n`;
    }
    
    // Format messages
    for (const message of messages) {
      switch (message.role) {
        case 'system':
          prompt += `System: ${message.content}\n\n`;
          break;
        case 'user':
          prompt += `User: ${message.content}\n\n`;
          break;
        case 'assistant':
          prompt += `Assistant: ${message.content}\n\n`;
          break;
        case 'function':
          prompt += `Function ${message.name || 'call'}: ${message.content}\n\n`;
          break;
      }
    }
    
    // Add final assistant prompt
    prompt += 'Assistant: ';
    
    return prompt.trim();
  }

  /**
   * Make HTTP request with retry logic
   */
  protected async makeRequest<T>(
    url: string,
    options: RequestInit,
    retries: number = 3
  ): Promise<T> {
    let lastError: Error | null = null;
    
    for (let i = 0; i < retries; i++) {
      try {
        const response = await fetch(url, {
          ...options,
          signal: AbortSignal.timeout(this.config.timeout || 60000)
        });
        
        if (!response.ok) {
          const error = await response.text();
          throw new LLMError(
            `HTTP ${response.status}: ${error}`,
            this.name,
            'HTTP_ERROR',
            response.status
          );
        }
        
        return await response.json() as T;
      } catch (error) {
        lastError = error as Error;
        
        // Don't retry on client errors (4xx)
        if (error instanceof LLMError && error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
          throw error;
        }
        
        // Exponential backoff
        if (i < retries - 1) {
          const delay = Math.min(1000 * Math.pow(2, i), 10000);
          this.logger.warn(`Request failed, retrying in ${delay}ms`, { 
            attempt: i + 1, 
            error: lastError.message 
          });
          await this.sleep(delay);
        }
      }
    }
    
    throw lastError || new LLMError('Request failed after retries', this.name);
  }

  /**
   * Sleep helper
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Validate configuration
   */
  protected validateConfig(): void {
    if (!this.config.enabled) {
      throw new LLMError(`Provider ${this.name} is not enabled`, this.name);
    }
    
    // Additional validation can be added by subclasses
  }

  /**
   * Parse SSE (Server-Sent Events) stream
   */
  protected async *parseSSEStream(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncGenerator<string> {
    const decoder = new TextDecoder();
    let buffer = '';
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data: ')) {
          const data = trimmed.slice(6);
          if (data === '[DONE]') {
            return;
          }
          yield data;
        }
      }
    }
  }

  /**
   * Calculate token estimate (rough approximation)
   */
  protected estimateTokens(text: string): number {
    // Rough estimation: ~4 characters per token
    return Math.ceil(text.length / 4);
  }
}