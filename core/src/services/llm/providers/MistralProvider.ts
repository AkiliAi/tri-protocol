/**
 * Mistral Provider
 * Provider for Mistral AI models
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
  EmbeddingOptions,
  EmbeddingResponse,
  StreamOptions
} from '../types';

interface MistralMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface MistralChatRequest {
  model: string;
  messages: MistralMessage[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stream?: boolean;
  safe_prompt?: boolean;
  random_seed?: number;
}

interface MistralChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: 'stop' | 'length' | 'model_length';
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface MistralEmbeddingRequest {
  model: string;
  input: string | string[];
  encoding_format?: 'float';
}

interface MistralEmbeddingResponse {
  id: string;
  object: string;
  data: Array<{
    object: string;
    embedding: number[];
    index: number;
  }>;
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

interface MistralStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
    };
    finish_reason: string | null;
  }>;
}

export class MistralProvider extends BaseProvider {
  name: LLMProviderType = 'mistral';
  private apiKey: string;
  private apiUrl: string;
  private defaultModel: string;

  constructor(config: ProviderConfig) {
    super(config);
    
    if (!config.apiKey) {
      throw new LLMError('Mistral API key is required', this.name);
    }
    
    this.apiKey = config.apiKey;
    this.apiUrl = config.endpoint || 'https://api.mistral.ai/v1';
    this.defaultModel = config.model || 'mistral-large-latest';
    
    // Set capabilities
    this.capabilities = {
      chat: true,
      completion: true,
      streaming: true,
      embeddings: true,
      functionCalling: true,
      jsonMode: true,
      vision: false
    };
  }

  async initialize(): Promise<void> {
    try {
      // Test API key by listing models
      const response = await fetch(`${this.apiUrl}/models`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        },
        signal: AbortSignal.timeout(5000)
      });
      
      if (response.status === 401) {
        throw new Error('Invalid API key');
      }
      
      if (!response.ok && response.status !== 429) {
        throw new Error(`API returned ${response.status}`);
      }
      
      this.available = true;
      this.logger.info('Mistral provider initialized');
    } catch (error) {
      this.logger.error('Mistral initialization failed', { error: (error as Error).message });
      this.available = false;
    }
  }

  async complete(prompt: string, options?: CompletionOptions): Promise<LLMResponse> {
    // Mistral uses chat completions, so convert to chat format
    const messages: ChatMessage[] = [];
    
    if (options?.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt });
    }
    
    messages.push({ role: 'user', content: prompt });
    
    return this.chat(messages, options);
  }

  async chat(messages: ChatMessage[], options?: CompletionOptions): Promise<LLMResponse> {
    if (!this.available) {
      throw new LLMError('Mistral provider is not available', this.name);
    }

    const model = options?.model || this.defaultModel;
    const startTime = Date.now();

    try {
      // Convert messages to Mistral format
      const mistralMessages: MistralMessage[] = messages.map(msg => ({
        role: msg.role === 'function' ? 'assistant' : msg.role as 'system' | 'user' | 'assistant',
        content: msg.content
      }));

      const request: MistralChatRequest = {
        model,
        messages: mistralMessages,
        temperature: options?.temperature,
        top_p: options?.topP,
        max_tokens: options?.maxTokens,
        stream: false,
        safe_prompt: false // Disable safety prompt for more control
      };

      const response = await this.makeRequest<MistralChatResponse>(
        `${this.apiUrl}/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify(request)
        }
      );

      const choice = response.choices[0];
      
      return {
        content: choice.message.content,
        provider: 'mistral',
        model: response.model,
        usage: {
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
          totalTokens: response.usage.total_tokens
        },
        latency: Date.now() - startTime,
        finishReason: choice.finish_reason === 'stop' ? 'stop' : 'length'
      };
    } catch (error) {
      if (error instanceof LLMError) {
        if (error.statusCode === 429) {
          throw new RateLimitError(this.name);
        }
        throw error;
      }
      
      this.logger.error('Mistral chat failed', { error: (error as Error).message });
      throw new LLMError(
        `Mistral chat failed: ${(error as Error).message}`,
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
      throw new LLMError('Mistral provider is not available', this.name);
    }

    const model = options?.model || this.defaultModel;
    const startTime = Date.now();
    let fullResponse = '';

    try {
      const messages: MistralMessage[] = [];
      
      if (options?.systemPrompt) {
        messages.push({ role: 'system', content: options.systemPrompt });
      }
      
      messages.push({ role: 'user', content: prompt });

      const request: MistralChatRequest = {
        model,
        messages,
        temperature: options?.temperature,
        top_p: options?.topP,
        max_tokens: options?.maxTokens,
        stream: true
      };

      const response = await fetch(`${this.apiUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream'
        },
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
          const data: MistralStreamChunk = JSON.parse(chunk);
          
          if (data.choices && data.choices[0]?.delta?.content) {
            const content = data.choices[0].delta.content;
            fullResponse += content;
            onChunk(content);
            
            if (options?.onToken) {
              options.onToken(content);
            }
          }
          
          // Check if done
          if (data.choices && data.choices[0]?.finish_reason) {
            if (options?.onComplete) {
              options.onComplete({
                content: fullResponse,
                provider: 'mistral',
                model: data.model,
                latency: Date.now() - startTime,
                finishReason: data.choices[0].finish_reason === 'stop' ? 'stop' : 'length'
              });
            }
          }
        } catch (parseError) {
          this.logger.warn('Failed to parse streaming response', { 
            chunk, 
            error: (parseError as Error).message 
          });
        }
      }
    } catch (error) {
      this.logger.error('Mistral streaming failed', { error: (error as Error).message });
      if (options?.onError) {
        options.onError(error as Error);
      }
      throw new LLMError(
        `Mistral streaming failed: ${(error as Error).message}`,
        this.name
      );
    }
  }

  async embed(text: string, options?: EmbeddingOptions): Promise<EmbeddingResponse> {
    if (!this.available) {
      throw new LLMError('Mistral provider is not available', this.name);
    }

    const model = options?.model || 'mistral-embed';

    try {
      const request: MistralEmbeddingRequest = {
        model,
        input: text,
        encoding_format: 'float'
      };

      const response = await this.makeRequest<MistralEmbeddingResponse>(
        `${this.apiUrl}/embeddings`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(request)
        }
      );

      return {
        embedding: response.data[0].embedding,
        provider: 'mistral',
        model: response.model,
        dimensions: response.data[0].embedding.length
      };
    } catch (error) {
      this.logger.error('Mistral embedding failed', { error: (error as Error).message });
      throw new LLMError(
        `Mistral embedding failed: ${(error as Error).message}`,
        this.name
      );
    }
  }

  /**
   * List available Mistral models
   */
  async listModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.apiUrl}/models`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        return (data as any).data.map((model: any) => model.id);
      }
      return [];
    } catch (error) {
      this.logger.error('Failed to list Mistral models', { error: (error as Error).message });
      return [];
    }
  }

  /**
   * Get available Mistral models
   */
  getAvailableModels(): string[] {
    return [
      'mistral-large-latest',
      'mistral-large-2402',
      'mistral-medium-latest',
      'mistral-medium-2312',
      'mistral-small-latest',
      'mistral-small-2402',
      'mistral-small-2312',
      'mistral-tiny-latest',
      'mistral-tiny-2312',
      'mistral-embed',
      'open-mistral-7b',
      'open-mixtral-8x7b',
      'open-mixtral-8x22b'
    ];
  }
}