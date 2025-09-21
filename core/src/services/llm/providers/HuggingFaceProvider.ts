/**
 * HuggingFace Provider
 * Provider for HuggingFace Inference API
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

interface HuggingFaceRequest {
  inputs: string;
  parameters?: {
    temperature?: number;
    top_p?: number;
    top_k?: number;
    max_new_tokens?: number;
    max_length?: number;
    min_length?: number;
    do_sample?: boolean;
    early_stopping?: boolean;
    num_beams?: number;
    num_return_sequences?: number;
    repetition_penalty?: number;
    return_full_text?: boolean;
    use_cache?: boolean;
    wait_for_model?: boolean;
  };
  options?: {
    use_cache?: boolean;
    wait_for_model?: boolean;
  };
}

interface HuggingFaceResponse {
  generated_text?: string;
  score?: number;
  token?: {
    id: number;
    text: string;
    logprob: number;
    special: boolean;
  };
  generated_token?: number;
  details?: {
    finish_reason: string;
    generated_tokens: number;
    seed: number;
    prefill: Array<{
      id: number;
      text: string;
      logprob: number;
    }>;
    tokens: Array<{
      id: number;
      text: string;
      logprob: number;
      special: boolean;
    }>;
  };
}

interface HuggingFaceEmbeddingResponse {
  embeddings?: number[][];
  outputs?: number[][];
}

interface HuggingFaceStreamResponse {
  token: {
    id: number;
    text: string;
    logprob: number;
    special: boolean;
  };
  generated_text: string | null;
  details: {
    finish_reason: string;
    generated_tokens: number;
  } | null;
}

export class HuggingFaceProvider extends BaseProvider {
  name: LLMProviderType = 'huggingface';
  private apiKey: string;
  private apiUrl: string;
  private defaultModel: string;
  private inferenceEndpoint: boolean = false;

  constructor(config: ProviderConfig) {
    super(config);
    
    if (!config.apiKey) {
      throw new LLMError('HuggingFace API key is required', this.name);
    }
    
    this.apiKey = config.apiKey;
    this.defaultModel = config.model || 'meta-llama/Llama-2-70b-chat-hf';
    
    // Check if using dedicated inference endpoint or public API
    if (config.endpoint && config.endpoint.includes('endpoints')) {
      this.apiUrl = config.endpoint;
      this.inferenceEndpoint = true;
    } else {
      this.apiUrl = 'https://api-inference.huggingface.co/models';
    }
    
    // Set capabilities
    this.capabilities = {
      chat: false, // Most models are completion-based
      completion: true,
      streaming: true, // Available for some models
      embeddings: true,
      functionCalling: false,
      jsonMode: false,
      vision: false // Some models support it, but not generally
    };
  }

  async initialize(): Promise<void> {
    try {
      // Test API key with a minimal request
      const testUrl = this.inferenceEndpoint 
        ? this.apiUrl 
        : `${this.apiUrl}/${this.defaultModel}`;
        
      const response = await fetch(testUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          inputs: 'test',
          parameters: { max_new_tokens: 1 },
          options: { wait_for_model: false }
        }),
        signal: AbortSignal.timeout(5000)
      });
      
      if (response.status === 401) {
        throw new Error('Invalid API key');
      }
      
      // 503 means model is loading, which is fine
      if (response.status !== 200 && response.status !== 503 && response.status !== 429) {
        throw new Error(`API returned ${response.status}`);
      }
      
      this.available = true;
      this.logger.info('HuggingFace provider initialized', { 
        model: this.defaultModel,
        inferenceEndpoint: this.inferenceEndpoint 
      });
    } catch (error) {
      this.logger.error('HuggingFace initialization failed', { error: (error as Error).message });
      this.available = false;
    }
  }

  async complete(prompt: string, options?: CompletionOptions): Promise<LLMResponse> {
    if (!this.available) {
      throw new LLMError('HuggingFace provider is not available', this.name);
    }

    const model = options?.model || this.defaultModel;
    const startTime = Date.now();

    try {
      // Add system prompt if provided
      let fullPrompt = prompt;
      if (options?.systemPrompt) {
        fullPrompt = `System: ${options.systemPrompt}\n\nUser: ${prompt}\n\nAssistant:`;
      }

      const request: HuggingFaceRequest = {
        inputs: fullPrompt,
        parameters: {
          temperature: options?.temperature,
          top_p: options?.topP,
          top_k: options?.topK,
          max_new_tokens: options?.maxTokens,
          return_full_text: false,
          do_sample: options?.temperature !== undefined && options.temperature > 0,
          wait_for_model: true
        },
        options: {
          wait_for_model: true,
          use_cache: false
        }
      };

      const url = this.inferenceEndpoint ? this.apiUrl : `${this.apiUrl}/${model}`;
      
      const response = await this.makeRequest<HuggingFaceResponse | HuggingFaceResponse[]>(
        url,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(request)
        }
      );

      // Handle both single and array responses
      const result = Array.isArray(response) ? response[0] : response;
      const generatedText = result.generated_text || '';

      return {
        content: generatedText,
        provider: 'huggingface',
        model,
        usage: result.details ? {
          promptTokens: this.estimateTokens(fullPrompt),
          completionTokens: result.details.generated_tokens,
          totalTokens: this.estimateTokens(fullPrompt) + result.details.generated_tokens
        } : undefined,
        latency: Date.now() - startTime,
        finishReason: result.details?.finish_reason === 'length' ? 'length' : 'stop'
      };
    } catch (error) {
      if (error instanceof LLMError) {
        if (error.statusCode === 429) {
          throw new RateLimitError(this.name);
        }
        if (error.statusCode === 503) {
          throw new LLMError('Model is loading, please try again', this.name, 'MODEL_LOADING', 503);
        }
        throw error;
      }
      
      this.logger.error('HuggingFace completion failed', { error: (error as Error).message });
      throw new LLMError(
        `HuggingFace completion failed: ${(error as Error).message}`,
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
      throw new LLMError('HuggingFace provider is not available', this.name);
    }

    const model = options?.model || this.defaultModel;
    const startTime = Date.now();
    let fullResponse = '';
    let generatedTokens = 0;

    try {
      // Add system prompt if provided
      let fullPrompt = prompt;
      if (options?.systemPrompt) {
        fullPrompt = `System: ${options.systemPrompt}\n\nUser: ${prompt}\n\nAssistant:`;
      }

      const request: HuggingFaceRequest = {
        inputs: fullPrompt,
        parameters: {
          temperature: options?.temperature,
          top_p: options?.topP,
          top_k: options?.topK,
          max_new_tokens: options?.maxTokens,
          return_full_text: false,
          do_sample: options?.temperature !== undefined && options.temperature > 0
        }
      };

      const url = this.inferenceEndpoint 
        ? `${this.apiUrl}/stream`
        : `${this.apiUrl}/${model}/stream`;
      
      const response = await fetch(url, {
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
          const data: HuggingFaceStreamResponse = JSON.parse(chunk);
          
          if (data.token?.text) {
            fullResponse += data.token.text;
            onChunk(data.token.text);
            generatedTokens++;
            
            if (options?.onToken) {
              options.onToken(data.token.text);
            }
          }
          
          // Check if done
          if (data.generated_text !== null || data.details?.finish_reason) {
            if (options?.onComplete) {
              options.onComplete({
                content: fullResponse,
                provider: 'huggingface',
                model,
                usage: {
                  promptTokens: this.estimateTokens(fullPrompt),
                  completionTokens: generatedTokens,
                  totalTokens: this.estimateTokens(fullPrompt) + generatedTokens
                },
                latency: Date.now() - startTime,
                finishReason: data.details?.finish_reason === 'length' ? 'length' : 'stop'
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
      this.logger.error('HuggingFace streaming failed', { error: (error as Error).message });
      if (options?.onError) {
        options.onError(error as Error);
      }
      throw new LLMError(
        `HuggingFace streaming failed: ${(error as Error).message}`,
        this.name
      );
    }
  }

  async embed(text: string, options?: EmbeddingOptions): Promise<EmbeddingResponse> {
    if (!this.available) {
      throw new LLMError('HuggingFace provider is not available', this.name);
    }

    const model = options?.model || 'sentence-transformers/all-MiniLM-L6-v2';

    try {
      const url = this.inferenceEndpoint 
        ? `${this.apiUrl}/feature-extraction`
        : `${this.apiUrl}/${model}`;
      
      const response = await this.makeRequest<HuggingFaceEmbeddingResponse | number[]>(
        url,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            inputs: text,
            options: { wait_for_model: true }
          })
        }
      );

      // Handle different response formats
      let embedding: number[];
      if (Array.isArray(response)) {
        embedding = response;
      } else if ((response as HuggingFaceEmbeddingResponse).embeddings) {
        embedding = (response as HuggingFaceEmbeddingResponse).embeddings![0];
      } else if ((response as HuggingFaceEmbeddingResponse).outputs) {
        embedding = (response as HuggingFaceEmbeddingResponse).outputs![0];
      } else {
        throw new Error('Unexpected embedding response format');
      }

      return {
        embedding,
        provider: 'huggingface',
        model,
        dimensions: embedding.length
      };
    } catch (error) {
      this.logger.error('HuggingFace embedding failed', { error: (error as Error).message });
      throw new LLMError(
        `HuggingFace embedding failed: ${(error as Error).message}`,
        this.name
      );
    }
  }

  /**
   * Get recommended models for different tasks
   */
  getRecommendedModels(): Record<string, string> {
    return {
      chat: 'meta-llama/Llama-2-70b-chat-hf',
      completion: 'bigscience/bloom',
      embeddings: 'sentence-transformers/all-MiniLM-L6-v2',
      codeGeneration: 'Salesforce/codegen-2B-multi',
      summarization: 'facebook/bart-large-cnn',
      translation: 'Helsinki-NLP/opus-mt-en-de'
    };
  }
}