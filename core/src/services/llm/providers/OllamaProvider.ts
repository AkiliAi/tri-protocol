/**
 * Ollama Provider
 * Default LLM provider for local model execution
 */

import { BaseProvider } from './BaseProvider';
import {
  LLMProviderType,
  ProviderConfig,
  CompletionOptions,
  LLMResponse,
  ChatMessage,
  LLMError,
  EmbeddingOptions,
  EmbeddingResponse,
  StreamOptions
} from '../types';

interface OllamaGenerateRequest {
  model: string;
  prompt?: string;
  messages?: Array<{ role: string; content: string }>;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  num_predict?: number;
  stream?: boolean;
  format?: string;
  system?: string;
  template?: string;
  context?: number[];
  options?: {
    temperature?: number;
    top_p?: number;
    top_k?: number;
    num_predict?: number;
  };
}

interface OllamaGenerateResponse {
  model: string;
  created_at: string;
  response: string;
  message?: { role: string; content: string };
  done: boolean;
  context?: number[];
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

interface OllamaEmbeddingRequest {
  model: string;
  prompt: string;
}

interface OllamaEmbeddingResponse {
  embedding: number[];
}

interface OllamaModel {
  name: string;
  modified_at: string;
  size: number;
  digest: string;
}

export class OllamaProvider extends BaseProvider {
  name: LLMProviderType = 'ollama';
  private endpoint: string;
  private defaultModel: string;
  private availableModels: string[] = [];

  constructor(config: ProviderConfig) {
    super(config);
    this.endpoint = config.endpoint || 'http://localhost:11434';
    this.defaultModel = config.model || 'qwen2.5:7b';
    
    // Set capabilities
    this.capabilities = {
      chat: true,
      completion: true,
      streaming: true,
      embeddings: true,
      functionCalling: false,
      jsonMode: true,
      vision: true // Some Ollama models support vision
    };
  }

  async initialize(): Promise<void> {
    try {
      // Check if Ollama is running
      const versionResponse = await fetch(`${this.endpoint}/api/version`, {
        signal: AbortSignal.timeout(5000)
      });
      
      if (!versionResponse.ok) {
        throw new Error('Ollama not responding');
      }
      
      // Get available models
      const modelsResponse = await fetch(`${this.endpoint}/api/tags`);
      if (modelsResponse.ok) {
        const data = await modelsResponse.json();
        this.availableModels = ((data as any).models || []).map((m: OllamaModel) => m.name);
        this.logger.info('Ollama initialized', { 
          models: this.availableModels,
          endpoint: this.endpoint 
        });
      }
      
      this.available = true;
    } catch (error) {
      this.logger.error('Ollama initialization failed', { 
        error: (error as Error).message,
        endpoint: this.endpoint 
      });
      this.available = false;
    }
  }

  async complete(prompt: string, options?: CompletionOptions): Promise<LLMResponse> {
    if (!this.available) {
      throw new LLMError('Ollama provider is not available', this.name);
    }

    const model = options?.model || this.defaultModel;
    const startTime = Date.now();

    try {
      const request: OllamaGenerateRequest = {
        model,
        prompt,
        stream: false,
        options: {
          temperature: options?.temperature,
          top_p: options?.topP,
          top_k: options?.topK,
          num_predict: options?.maxTokens
        }
      };

      // Add system prompt if provided
      if (options?.systemPrompt) {
        request.system = options.systemPrompt;
      }

      // Add JSON format if requested
      if (options?.format === 'json') {
        request.format = 'json';
      }

      const response = await this.makeRequest<OllamaGenerateResponse>(
        `${this.endpoint}/api/generate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request)
        }
      );

      return {
        content: response.response,
        provider: 'ollama',
        model,
        usage: {
          promptTokens: response.prompt_eval_count || 0,
          completionTokens: response.eval_count || 0,
          totalTokens: (response.prompt_eval_count || 0) + (response.eval_count || 0)
        },
        latency: Date.now() - startTime,
        finishReason: response.done ? 'stop' : 'length'
      };
    } catch (error) {
      this.logger.error('Ollama completion failed', { error: (error as Error).message });
      throw new LLMError(
        `Ollama completion failed: ${(error as Error).message}`,
        this.name
      );
    }
  }

  async chat(messages: ChatMessage[], options?: CompletionOptions): Promise<LLMResponse> {
    if (!this.available) {
      throw new LLMError('Ollama provider is not available', this.name);
    }

    const model = options?.model || this.defaultModel;
    const startTime = Date.now();

    try {
      // Convert messages to Ollama format
      const ollamaMessages = messages.map(msg => ({
        role: msg.role === 'assistant' ? 'assistant' : msg.role === 'system' ? 'system' : 'user',
        content: msg.content
      }));

      const request: OllamaGenerateRequest = {
        model,
        messages: ollamaMessages,
        stream: false,
        options: {
          temperature: options?.temperature,
          top_p: options?.topP,
          top_k: options?.topK,
          num_predict: options?.maxTokens
        }
      };

      // Add JSON format if requested
      if (options?.format === 'json') {
        request.format = 'json';
      }

      const response = await this.makeRequest<OllamaGenerateResponse>(
        `${this.endpoint}/api/chat`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request)
        }
      );

      return {
        content: response.message?.content || response.response,
        provider: 'ollama',
        model,
        usage: {
          promptTokens: response.prompt_eval_count || 0,
          completionTokens: response.eval_count || 0,
          totalTokens: (response.prompt_eval_count || 0) + (response.eval_count || 0)
        },
        latency: Date.now() - startTime,
        finishReason: response.done ? 'stop' : 'length'
      };
    } catch (error) {
      this.logger.error('Ollama chat failed', { error: (error as Error).message });
      throw new LLMError(
        `Ollama chat failed: ${(error as Error).message}`,
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
      throw new LLMError('Ollama provider is not available', this.name);
    }

    const model = options?.model || this.defaultModel;
    const startTime = Date.now();
    let fullResponse = '';
    let promptTokens = 0;
    let completionTokens = 0;

    try {
      const request: OllamaGenerateRequest = {
        model,
        prompt,
        stream: true,
        options: {
          temperature: options?.temperature,
          top_p: options?.topP,
          top_k: options?.topK,
          num_predict: options?.maxTokens
        }
      };

      // Add system prompt if provided
      if (options?.systemPrompt) {
        request.system = options.systemPrompt;
      }

      const response = await fetch(`${this.endpoint}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(options?.timeout || 60000)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.trim()) {
            try {
              const data: OllamaGenerateResponse = JSON.parse(line);
              
              if (data.response) {
                fullResponse += data.response;
                onChunk(data.response);
                
                if (options?.onToken) {
                  options.onToken(data.response);
                }
              }
              
              // Update token counts
              if (data.prompt_eval_count) {
                promptTokens = data.prompt_eval_count;
              }
              if (data.eval_count) {
                completionTokens = data.eval_count;
              }
              
              // Check if done
              if (data.done) {
                if (options?.onComplete) {
                  options.onComplete({
                    content: fullResponse,
                    provider: 'ollama',
                    model,
                    usage: {
                      promptTokens,
                      completionTokens,
                      totalTokens: promptTokens + completionTokens
                    },
                    latency: Date.now() - startTime,
                    finishReason: 'stop'
                  });
                }
              }
            } catch (parseError) {
              this.logger.warn('Failed to parse streaming response', { 
                line, 
                error: (parseError as Error).message 
              });
            }
          }
        }
      }
    } catch (error) {
      this.logger.error('Ollama streaming failed', { error: (error as Error).message });
      if (options?.onError) {
        options.onError(error as Error);
      }
      throw new LLMError(
        `Ollama streaming failed: ${(error as Error).message}`,
        this.name
      );
    }
  }

  async embed(text: string, options?: EmbeddingOptions): Promise<EmbeddingResponse> {
    if (!this.available) {
      throw new LLMError('Ollama provider is not available', this.name);
    }

    const model = options?.model || 'nomic-embed-text';

    try {
      const request: OllamaEmbeddingRequest = {
        model,
        prompt: text
      };

      const response = await this.makeRequest<OllamaEmbeddingResponse>(
        `${this.endpoint}/api/embeddings`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request)
        }
      );

      return {
        embedding: response.embedding,
        provider: 'ollama',
        model,
        dimensions: response.embedding.length
      };
    } catch (error) {
      this.logger.error('Ollama embedding failed', { error: (error as Error).message });
      throw new LLMError(
        `Ollama embedding failed: ${(error as Error).message}`,
        this.name
      );
    }
  }

  /**
   * List available models
   */
  async listModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.endpoint}/api/tags`);
      if (response.ok) {
        const data = await response.json();
        return ((data as any).models || []).map((m: OllamaModel) => m.name);
      }
      return [];
    } catch (error) {
      this.logger.error('Failed to list Ollama models', { error: (error as Error).message });
      return [];
    }
  }

  /**
   * Pull a model from Ollama library
   */
  async pullModel(modelName: string): Promise<void> {
    try {
      const response = await fetch(`${this.endpoint}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelName, stream: false })
      });

      if (!response.ok) {
        throw new Error(`Failed to pull model: ${await response.text()}`);
      }

      this.logger.info('Model pulled successfully', { model: modelName });
      
      // Refresh available models
      this.availableModels = await this.listModels();
    } catch (error) {
      this.logger.error('Failed to pull model', { 
        model: modelName, 
        error: (error as Error).message 
      });
      throw new LLMError(
        `Failed to pull model ${modelName}: ${(error as Error).message}`,
        this.name
      );
    }
  }

  /**
   * Check if a specific model is available
   */
  hasModel(modelName: string): boolean {
    return this.availableModels.includes(modelName);
  }
}