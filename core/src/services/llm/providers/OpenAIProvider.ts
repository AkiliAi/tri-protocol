/**
 * OpenAI Provider
 * Provider for OpenAI GPT models
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

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'function';
  content: string;
  name?: string;
  function_call?: {
    name: string;
    arguments: string;
  };
}

interface OpenAIChatRequest {
  model: string;
  messages: OpenAIMessage[];
  temperature?: number;
  top_p?: number;
  n?: number;
  stream?: boolean;
  max_tokens?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  logit_bias?: Record<string, number>;
  user?: string;
  response_format?: { type: 'text' | 'json_object' };
  seed?: number;
  tools?: Array<{
    type: 'function';
    function: {
      name: string;
      description?: string;
      parameters?: any;
    };
  }>;
  tool_choice?: 'none' | 'auto' | { type: 'function'; function: { name: string } };
}

interface OpenAIChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  system_fingerprint?: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
    logprobs?: any;
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'function_call';
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface OpenAIEmbeddingRequest {
  input: string | string[];
  model: string;
  encoding_format?: 'float' | 'base64';
  dimensions?: number;
  user?: string;
}

interface OpenAIEmbeddingResponse {
  object: string;
  data: Array<{
    object: string;
    index: number;
    embedding: number[];
  }>;
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

export class OpenAIProvider extends BaseProvider {
  name: LLMProviderType = 'openai';
  private apiKey: string;
  private apiUrl: string;
  private defaultModel: string;
  private organizationId?: string;

  constructor(config: ProviderConfig) {
    super(config);
    
    if (!config.apiKey) {
      throw new LLMError('OpenAI API key is required', this.name);
    }
    
    this.apiKey = config.apiKey;
    this.apiUrl = config.endpoint || 'https://api.openai.com/v1';
    this.defaultModel = config.model || 'gpt-4-turbo-preview';
    this.organizationId = process.env.OPENAI_ORG_ID;
    
    // Set capabilities
    this.capabilities = {
      chat: true,
      completion: true,
      streaming: true,
      embeddings: true,
      functionCalling: true,
      jsonMode: true,
      vision: true
    };
  }

  async initialize(): Promise<void> {
    try {
      // Test API key by fetching models
      const response = await fetch(`${this.apiUrl}/models`, {
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(5000)
      });
      
      if (response.status === 401) {
        throw new Error('Invalid API key');
      }
      
      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }
      
      this.available = true;
      this.logger.info('OpenAI provider initialized');
    } catch (error) {
      this.logger.error('OpenAI initialization failed', { error: (error as Error).message });
      this.available = false;
    }
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json'
    };
    
    if (this.organizationId) {
      headers['OpenAI-Organization'] = this.organizationId;
    }
    
    return headers;
  }

  async complete(prompt: string, options?: CompletionOptions): Promise<LLMResponse> {
    // OpenAI deprecated completions API, use chat instead
    const messages: ChatMessage[] = [];
    
    if (options?.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt });
    }
    
    messages.push({ role: 'user', content: prompt });
    
    return this.chat(messages, options);
  }

  async chat(messages: ChatMessage[], options?: CompletionOptions): Promise<LLMResponse> {
    if (!this.available) {
      throw new LLMError('OpenAI provider is not available', this.name);
    }

    const model = options?.model || this.defaultModel;
    const startTime = Date.now();

    try {
      const request: OpenAIChatRequest = {
        model,
        messages: messages.map(msg => ({
          role: msg.role,
          content: msg.content,
          name: msg.name
        })),
        temperature: options?.temperature,
        top_p: options?.topP,
        max_tokens: options?.maxTokens,
        stream: false
      };

      // Add JSON mode if requested
      if (options?.format === 'json') {
        request.response_format = { type: 'json_object' };
      }

      const response = await this.makeRequest<OpenAIChatResponse>(
        `${this.apiUrl}/chat/completions`,
        {
          method: 'POST',
          headers: this.getHeaders(),
          body: JSON.stringify(request)
        }
      );

      const choice = response.choices[0];
      
      return {
        content: choice.message.content || '',
        provider: 'openai',
        model: response.model,
        usage: {
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
          totalTokens: response.usage.total_tokens
        },
        latency: Date.now() - startTime,
        finishReason: choice.finish_reason === 'stop' ? 'stop' : 
                      choice.finish_reason === 'length' ? 'length' : 'error'
      };
    } catch (error) {
      if (error instanceof LLMError) {
        // Check for rate limit
        if (error.statusCode === 429) {
          throw new RateLimitError(this.name);
        }
        throw error;
      }
      
      this.logger.error('OpenAI chat failed', { error: (error as Error).message });
      throw new LLMError(
        `OpenAI chat failed: ${(error as Error).message}`,
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
      throw new LLMError('OpenAI provider is not available', this.name);
    }

    const model = options?.model || this.defaultModel;
    const startTime = Date.now();
    let fullResponse = '';
    let promptTokens = 0;
    let completionTokens = 0;

    try {
      const messages: OpenAIMessage[] = [];
      
      if (options?.systemPrompt) {
        messages.push({ role: 'system', content: options.systemPrompt });
      }
      
      messages.push({ role: 'user', content: prompt });

      const request: OpenAIChatRequest = {
        model,
        messages,
        temperature: options?.temperature,
        top_p: options?.topP,
        max_tokens: options?.maxTokens,
        stream: true
      };

      // Add JSON mode if requested
      if (options?.format === 'json') {
        request.response_format = { type: 'json_object' };
      }

      const response = await fetch(`${this.apiUrl}/chat/completions`, {
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
          const data = JSON.parse(chunk);
          
          if (data.choices && data.choices[0]?.delta?.content) {
            const content = data.choices[0].delta.content;
            fullResponse += content;
            onChunk(content);
            
            if (options?.onToken) {
              options.onToken(content);
            }
          }
          
          // Update usage if available (usually in the last chunk)
          if (data.usage) {
            promptTokens = data.usage.prompt_tokens;
            completionTokens = data.usage.completion_tokens;
          }
          
          // Check if done
          if (data.choices && data.choices[0]?.finish_reason) {
            if (options?.onComplete) {
              options.onComplete({
                content: fullResponse,
                provider: 'openai',
                model: data.model || model,
                usage: {
                  promptTokens,
                  completionTokens,
                  totalTokens: promptTokens + completionTokens
                },
                latency: Date.now() - startTime,
                finishReason: data.choices[0].finish_reason
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
      this.logger.error('OpenAI streaming failed', { error: (error as Error).message });
      if (options?.onError) {
        options.onError(error as Error);
      }
      throw new LLMError(
        `OpenAI streaming failed: ${(error as Error).message}`,
        this.name
      );
    }
  }

  async embed(text: string, options?: EmbeddingOptions): Promise<EmbeddingResponse> {
    if (!this.available) {
      throw new LLMError('OpenAI provider is not available', this.name);
    }

    const model = options?.model || 'text-embedding-3-small';

    try {
      const request: OpenAIEmbeddingRequest = {
        input: text,
        model,
        dimensions: options?.dimensions
      };

      const response = await this.makeRequest<OpenAIEmbeddingResponse>(
        `${this.apiUrl}/embeddings`,
        {
          method: 'POST',
          headers: this.getHeaders(),
          body: JSON.stringify(request)
        }
      );

      return {
        embedding: response.data[0].embedding,
        provider: 'openai',
        model: response.model,
        dimensions: response.data[0].embedding.length
      };
    } catch (error) {
      this.logger.error('OpenAI embedding failed', { error: (error as Error).message });
      throw new LLMError(
        `OpenAI embedding failed: ${(error as Error).message}`,
        this.name
      );
    }
  }

  /**
   * List available models
   */
  async listModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.apiUrl}/models`, {
        headers: this.getHeaders()
      });
      
      if (response.ok) {
        const data = await response.json();
        return (data as any).data.map((model: any) => model.id);
      }
      return [];
    } catch (error) {
      this.logger.error('Failed to list OpenAI models', { error: (error as Error).message });
      return [];
    }
  }
}