/**
 * Anthropic Provider
 * Provider for Claude models
 */

import { BaseProvider } from './BaseProvider';
import {
  LLMProviderType,
  ProviderConfig,
  CompletionOptions,
  LLMResponse,
  ChatMessage,
  LLMError,
  RateLimitError,
  StreamOptions
} from '../types';

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | Array<{
    type: 'text' | 'image';
    text?: string;
    source?: {
      type: 'base64';
      media_type: string;
      data: string;
    };
  }>;
}

interface AnthropicRequest {
  model: string;
  messages: AnthropicMessage[];
  max_tokens: number;
  system?: string;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  metadata?: {
    user_id?: string;
  };
  stop_sequences?: string[];
  stream?: boolean;
}

interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: Array<{
    type: 'text';
    text: string;
  }>;
  model: string;
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | null;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

interface AnthropicStreamEvent {
  type: 'message_start' | 'content_block_start' | 'content_block_delta' | 'content_block_stop' | 'message_delta' | 'message_stop' | 'error';
  message?: AnthropicResponse;
  index?: number;
  delta?: {
    type?: 'text_delta';
    text?: string;
    stop_reason?: string;
    stop_sequence?: string;
  };
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  error?: {
    type: string;
    message: string;
  };
}

export class AnthropicProvider extends BaseProvider {
  name: LLMProviderType = 'anthropic';
  private apiKey: string;
  private apiUrl: string;
  private defaultModel: string;
  private anthropicVersion: string = '2023-06-01';

  constructor(config: ProviderConfig) {
    super(config);
    
    if (!config.apiKey) {
      throw new LLMError('Anthropic API key is required', this.name);
    }
    
    this.apiKey = config.apiKey;
    this.apiUrl = config.endpoint || 'https://api.anthropic.com/v1';
    this.defaultModel = config.model || 'claude-3-opus-20240229';
    
    // Set capabilities
    this.capabilities = {
      chat: true,
      completion: true,
      streaming: true,
      embeddings: false, // Anthropic doesn't provide embeddings
      functionCalling: false, // Not yet supported
      jsonMode: false, // Can be prompted for JSON
      vision: true // Claude 3 supports vision
    };
  }

  async initialize(): Promise<void> {
    try {
      // Test API key with a minimal request
      const response = await fetch(`${this.apiUrl}/messages`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          model: this.defaultModel,
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 1
        }),
        signal: AbortSignal.timeout(5000)
      });
      
      if (response.status === 401) {
        throw new Error('Invalid API key');
      }
      
      // We expect either success or rate limit here
      if (response.status !== 200 && response.status !== 429) {
        throw new Error(`API returned ${response.status}`);
      }
      
      this.available = true;
      this.logger.info('Anthropic provider initialized');
    } catch (error) {
      this.logger.error('Anthropic initialization failed', { error: (error as Error).message });
      this.available = false;
    }
  }

  private getHeaders(): Record<string, string> {
    return {
      'x-api-key': this.apiKey,
      'anthropic-version': this.anthropicVersion,
      'Content-Type': 'application/json'
    };
  }

  async complete(prompt: string, options?: CompletionOptions): Promise<LLMResponse> {
    const messages: ChatMessage[] = [];
    
    if (options?.systemPrompt) {
      // System prompt is handled separately in Anthropic API
      messages.push({ role: 'user', content: prompt });
    } else {
      messages.push({ role: 'user', content: prompt });
    }
    
    return this.chat(messages, options);
  }

  async chat(messages: ChatMessage[], options?: CompletionOptions): Promise<LLMResponse> {
    if (!this.available) {
      throw new LLMError('Anthropic provider is not available', this.name);
    }

    const model = options?.model || this.defaultModel;
    const startTime = Date.now();

    try {
      // Convert messages to Anthropic format
      const anthropicMessages: AnthropicMessage[] = [];
      let systemPrompt: string | undefined;
      
      for (const msg of messages) {
        if (msg.role === 'system') {
          // Anthropic handles system messages separately
          systemPrompt = msg.content;
        } else if (msg.role === 'user' || msg.role === 'assistant') {
          anthropicMessages.push({
            role: msg.role,
            content: msg.content
          });
        }
      }
      
      // Ensure alternating user/assistant messages
      if (anthropicMessages.length === 0 || anthropicMessages[0].role !== 'user') {
        anthropicMessages.unshift({ role: 'user', content: 'Continue' });
      }

      const request: AnthropicRequest = {
        model,
        messages: anthropicMessages,
        max_tokens: options?.maxTokens || 1000,
        system: systemPrompt || options?.systemPrompt,
        temperature: options?.temperature,
        top_p: options?.topP,
        top_k: options?.topK,
        stream: false
      };

      const response = await this.makeRequest<AnthropicResponse>(
        `${this.apiUrl}/messages`,
        {
          method: 'POST',
          headers: this.getHeaders(),
          body: JSON.stringify(request)
        }
      );

      const content = response.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('');

      return {
        content,
        provider: 'anthropic',
        model: response.model,
        usage: {
          promptTokens: response.usage.input_tokens,
          completionTokens: response.usage.output_tokens,
          totalTokens: response.usage.input_tokens + response.usage.output_tokens
        },
        latency: Date.now() - startTime,
        finishReason: response.stop_reason === 'end_turn' ? 'stop' : 
                      response.stop_reason === 'max_tokens' ? 'length' : 'stop'
      };
    } catch (error) {
      if (error instanceof LLMError) {
        // Check for rate limit
        if (error.statusCode === 429) {
          throw new RateLimitError(this.name);
        }
        throw error;
      }
      
      this.logger.error('Anthropic chat failed', { error: (error as Error).message });
      throw new LLMError(
        `Anthropic chat failed: ${(error as Error).message}`,
        this.name
      );
    }
  }

  async stream(
    prompt: string,
    onChunk: (chunk: string) => void,
    options?: StreamOptions
  ): Promise<void> {
    if (!this.available) {
      throw new LLMError('Anthropic provider is not available', this.name);
    }

    const model = options?.model || this.defaultModel;
    const startTime = Date.now();
    let fullResponse = '';
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      const messages: AnthropicMessage[] = [{ role: 'user', content: prompt }];

      const request: AnthropicRequest = {
        model,
        messages,
        max_tokens: options?.maxTokens || 1000,
        system: options?.systemPrompt,
        temperature: options?.temperature,
        top_p: options?.topP,
        top_k: options?.topK,
        stream: true
      };

      const response = await fetch(`${this.apiUrl}/messages`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(options?.timeout || 60000)
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

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      // Parse SSE stream
      for await (const chunk of this.parseSSEStream(reader)) {
        try {
          const event: AnthropicStreamEvent = JSON.parse(chunk);
          
          switch (event.type) {
            case 'content_block_delta':
              if (event.delta?.text) {
                fullResponse += event.delta.text;
                onChunk(event.delta.text);
                
                if (options?.onToken) {
                  options.onToken(event.delta.text);
                }
              }
              break;
              
            case 'message_start':
              if (event.message?.usage) {
                inputTokens = event.message.usage.input_tokens;
              }
              break;
              
            case 'message_delta':
              if (event.usage?.output_tokens) {
                outputTokens = event.usage.output_tokens;
              }
              break;
              
            case 'message_stop':
              if (options?.onComplete) {
                options.onComplete({
                  content: fullResponse,
                  provider: 'anthropic',
                  model,
                  usage: {
                    promptTokens: inputTokens,
                    completionTokens: outputTokens,
                    totalTokens: inputTokens + outputTokens
                  },
                  latency: Date.now() - startTime,
                  finishReason: 'stop'
                });
              }
              break;
              
            case 'error':
              throw new Error(event.error?.message || 'Stream error');
          }
        } catch (parseError) {
          this.logger.warn('Failed to parse streaming response', { 
            chunk, 
            error: (parseError as Error).message 
          });
        }
      }
    } catch (error) {
      this.logger.error('Anthropic streaming failed', { error: (error as Error).message });
      if (options?.onError) {
        options.onError(error as Error);
      }
      throw new LLMError(
        `Anthropic streaming failed: ${(error as Error).message}`,
        this.name
      );
    }
  }

  /**
   * Count tokens for Anthropic models (rough estimate)
   */
  estimateTokens(text: string): number {
    // Anthropic uses a similar tokenization to GPT models
    // Rough estimate: ~4 characters per token
    return Math.ceil(text.length / 4);
  }

  /**
   * Get available Claude models
   */
  getAvailableModels(): string[] {
    return [
      'claude-3-opus-20240229',
      'claude-3-sonnet-20240229',
      'claude-3-haiku-20240307',
      'claude-2.1',
      'claude-2.0',
      'claude-instant-1.2'
    ];
  }
}