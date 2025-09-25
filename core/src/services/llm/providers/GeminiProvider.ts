/**
 * Gemini Provider
 * Provider for Google Gemini models
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

interface GeminiContent {
  parts: Array<{
    text?: string;
    inlineData?: {
      mimeType: string;
      data: string;
    };
  }>;
  role?: 'user' | 'model';
}

interface GeminiRequest {
  contents: GeminiContent[];
  generationConfig?: {
    temperature?: number;
    topP?: number;
    topK?: number;
    maxOutputTokens?: number;
    stopSequences?: string[];
    candidateCount?: number;
  };
  safetySettings?: Array<{
    category: string;
    threshold: string;
  }>;
  systemInstruction?: {
    parts: Array<{ text: string }>;
  };
}

interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: Array<{ text: string }>;
      role: string;
    };
    finishReason: string;
    index: number;
    safetyRatings?: Array<{
      category: string;
      probability: string;
    }>;
  }>;
  promptFeedback?: {
    safetyRatings?: Array<{
      category: string;
      probability: string;
    }>;
  };
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

interface GeminiEmbeddingRequest {
  model: string;
  content: {
    parts: Array<{ text: string }>;
  };
  taskType?: string;
  title?: string;
}

interface GeminiEmbeddingResponse {
  embedding: {
    values: number[];
  };
}

export class GeminiProvider extends BaseProvider {
  name: LLMProviderType = 'gemini';
  private apiKey: string;
  private apiUrl: string;
  private defaultModel: string;

  constructor(config: ProviderConfig) {
    super(config);
    
    if (!config.apiKey) {
      throw new LLMError('Gemini API key is required', this.name);
    }
    
    this.apiKey = config.apiKey;
    this.apiUrl = 'https://generativelanguage.googleapis.com/v1beta';
    this.defaultModel = config.model || 'gemini-pro';
    
    // Set capabilities
    this.capabilities = {
      chat: true,
      completion: true,
      streaming: true,
      embeddings: true,
      functionCalling: true,
      jsonMode: false, // Can be prompted for JSON
      vision: true // Gemini Pro Vision supports images
    };
  }

  async initialize(): Promise<void> {
    try {
      // Test API key by listing models
      const response = await fetch(
        `${this.apiUrl}/models`,
        {
          headers: {
            'X-goog-api-key': this.apiKey
          },
          signal: AbortSignal.timeout(5000)
        }
      );
      
      if (response.status === 401 || response.status === 403) {
        throw new Error('Invalid API key');
      }
      
      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }
      
      this.available = true;
      this.logger.info('Gemini provider initialized');
    } catch (error) {
      this.logger.error('Gemini initialization failed', { error: (error as Error).message });
      this.available = false;
    }
  }

  async complete(prompt: string, options?: CompletionOptions): Promise<LLMResponse> {
    const messages: ChatMessage[] = [];
    
    if (options?.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt });
    }
    
    messages.push({ role: 'user', content: prompt });
    
    return this.chat(messages, options);
  }

  async chat(messages: ChatMessage[], options?: CompletionOptions): Promise<LLMResponse> {
    if (!this.available) {
      throw new LLMError('Gemini provider is not available', this.name);
    }

    const model = options?.model || this.defaultModel;
    const startTime = Date.now();

    try {
      // Convert messages to Gemini format
      const contents: GeminiContent[] = [];
      let systemInstruction: { parts: Array<{ text: string }> } | undefined;
      
      for (const msg of messages) {
        if (msg.role === 'system') {
          systemInstruction = { parts: [{ text: msg.content }] };
        } else {
          contents.push({
            parts: [{ text: msg.content }],
            role: msg.role === 'assistant' ? 'model' : 'user'
          });
        }
      }
      
      // Ensure conversation starts with user
      if (contents.length === 0 || contents[0].role !== 'user') {
        contents.unshift({
          parts: [{ text: 'Hello' }],
          role: 'user'
        });
      }

      const request: GeminiRequest = {
        contents,
        generationConfig: {
          temperature: options?.temperature,
          topP: options?.topP,
          topK: options?.topK,
          maxOutputTokens: options?.maxTokens
        }
      };
      
      if (systemInstruction || options?.systemPrompt) {
        request.systemInstruction = systemInstruction || { 
          parts: [{ text: options?.systemPrompt || '' }] 
        };
      }

      const url = `${this.apiUrl}/models/${model}:generateContent`;

      const response = await this.makeRequest<GeminiResponse>(
        url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-goog-api-key': this.apiKey
          },
          body: JSON.stringify(request)
        }
      );

      if (!response.candidates || response.candidates.length === 0) {
        throw new LLMError('No response generated', this.name);
      }

      const candidate = response.candidates[0];
      const content = candidate.content.parts
        .map(part => part.text)
        .join('');

      return {
        content,
        provider: 'gemini',
        model,
        usage: response.usageMetadata ? {
          promptTokens: response.usageMetadata.promptTokenCount,
          completionTokens: response.usageMetadata.candidatesTokenCount,
          totalTokens: response.usageMetadata.totalTokenCount
        } : undefined,
        latency: Date.now() - startTime,
        finishReason: this.mapFinishReason(candidate.finishReason)
      };
    } catch (error) {
      if (error instanceof LLMError) {
        if (error.statusCode === 429) {
          throw new RateLimitError(this.name);
        }
        throw error;
      }
      
      this.logger.error('Gemini chat failed', { error: (error as Error).message });
      throw new LLMError(
        `Gemini chat failed: ${(error as Error).message}`,
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
      throw new LLMError('Gemini provider is not available', this.name);
    }

    const model = options?.model || this.defaultModel;
    const startTime = Date.now();
    let fullResponse = '';

    try {
      const contents: GeminiContent[] = [{
        parts: [{ text: prompt }],
        role: 'user'
      }];

      const request: GeminiRequest = {
        contents,
        generationConfig: {
          temperature: options?.temperature,
          topP: options?.topP,
          topK: options?.topK,
          maxOutputTokens: options?.maxTokens
        }
      };
      
      if (options?.systemPrompt) {
        request.systemInstruction = { 
          parts: [{ text: options.systemPrompt }] 
        };
      }

      const url = `${this.apiUrl}/models/${model}:streamGenerateContent?alt=sse`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-goog-api-key': this.apiKey
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
          const data: GeminiResponse = JSON.parse(chunk);
          
          if (data.candidates && data.candidates[0]?.content?.parts) {
            const text = data.candidates[0].content.parts
              .map(part => part.text)
              .join('');
            
            if (text) {
              fullResponse += text;
              onChunk(text);
              
              if (options?.onToken) {
                options.onToken(text);
              }
            }
          }
        } catch (parseError) {
          this.logger.warn('Failed to parse streaming response', { 
            chunk, 
            error: (parseError as Error).message 
          });
        }
      }
      
      if (options?.onComplete) {
        options.onComplete({
          content: fullResponse,
          provider: 'gemini',
          model,
          latency: Date.now() - startTime,
          finishReason: 'stop'
        });
      }
    } catch (error) {
      this.logger.error('Gemini streaming failed', { error: (error as Error).message });
      if (options?.onError) {
        options.onError(error as Error);
      }
      throw new LLMError(
        `Gemini streaming failed: ${(error as Error).message}`,
        this.name
      );
    }
  }

  async embed(text: string, options?: EmbeddingOptions): Promise<EmbeddingResponse> {
    if (!this.available) {
      throw new LLMError('Gemini provider is not available', this.name);
    }

    const model = options?.model || 'embedding-001';

    try {
      const request: GeminiEmbeddingRequest = {
        model: `models/${model}`,
        content: {
          parts: [{ text }]
        },
        taskType: 'RETRIEVAL_DOCUMENT'
      };

      const url = `${this.apiUrl}/models/${model}:embedContent`;

      const response = await this.makeRequest<GeminiEmbeddingResponse>(
        url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-goog-api-key': this.apiKey
          },
          body: JSON.stringify(request)
        }
      );

      return {
        embedding: response.embedding.values,
        provider: 'gemini',
        model,
        dimensions: response.embedding.values.length
      };
    } catch (error) {
      this.logger.error('Gemini embedding failed', { error: (error as Error).message });
      throw new LLMError(
        `Gemini embedding failed: ${(error as Error).message}`,
        this.name
      );
    }
  }

  private mapFinishReason(reason: string): 'stop' | 'length' | 'error' {
    switch (reason) {
      case 'STOP':
        return 'stop';
      case 'MAX_TOKENS':
        return 'length';
      default:
        return 'error';
    }
  }

  /**
   * List available Gemini models
   */
  async listModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.apiUrl}/models`, {
        headers: {
          'X-goog-api-key': this.apiKey
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        return (data as any).models.map((model: any) => model.name.replace('models/', ''));
      }
      return [];
    } catch (error) {
      this.logger.error('Failed to list Gemini models', { error: (error as Error).message });
      return [];
    }
  }
}