/**
 * LLM Service Tests
 * Comprehensive tests for the LLM Service
 */

import { LLMService } from '../../../../../core/src/services/llm/LLMService';
import { LLMCache } from '../../../../../core/src/services/llm/support/LLMCache';
import { RateLimiter } from '../../../../../core/src/services/llm/support/RateLimiter';
import { LLMMetrics } from '../../../../../core/src/services/llm/support/LLMMetrics';
import { ReasoningEngine } from '../../../../../core/src/services/llm/ReasoningEngine';
import {
  LLMConfig,
  LLMProviderType,
  CompletionOptions,
  ChatMessage,
  LLMError,
  RateLimitError,
  ProviderUnavailableError
} from '../../../../../core/src/services/llm/types';

// Mock fetch for testing
global.fetch = jest.fn();

describe('LLMService', () => {
  let llmService: LLMService;
  
  const mockConfig: LLMConfig = {
    providers: [
      { type: 'ollama', enabled: true, priority: 1, endpoint: 'http://localhost:11434' },
      { type: 'openai', enabled: false, priority: 2 },
      { type: 'anthropic', enabled: false, priority: 3 }
    ],
    defaultProvider: 'ollama',
    enableCache: true,
    fallbackStrategy: 'cascade',
    cacheConfig: {
      ttl: 60000,
      maxSize: 1024 * 1024
    },
    rateLimits: {
      ollama: {rpm: 60},

    }
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Mock Ollama availability check
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('/api/version')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ version: '0.1.0' })
        });
      }
      if (url.includes('/api/tags')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ 
            models: [
              { name: 'llama2', modified_at: '2024-01-01', size: 1000000, digest: 'abc123' }
            ] 
          })
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({})
      });
    });
    
    llmService = new LLMService(mockConfig);
  });

  afterEach(async () => {
    await llmService.stop();
  });

  describe('Initialization', () => {
    it('should initialize with default configuration', () => {
      const status = llmService.getStatus();
      expect(status.defaultProvider).toBe('ollama');
      expect(status.providers).toHaveLength(3);
    });

    it('should enable cache when configured', () => {
      const cache = llmService.getCache();
      expect(cache).toBeInstanceOf(LLMCache);
    });

    it('should initialize metrics', () => {
      const metrics = llmService.getMetrics();
      expect(metrics).toBeInstanceOf(LLMMetrics);
    });
  });

  describe('Completion', () => {
    beforeEach(() => {
      // Mock Ollama completion
      (global.fetch as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('/api/generate')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              model: 'llama2',
              response: 'Test response',
              done: true,
              prompt_eval_count: 10,
              eval_count: 20
            })
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({})
        });
      });
    });

    it('should complete a prompt', async () => {
      const response = await llmService.complete('Test prompt');
      expect(response.content).toBe('Test response');
      expect(response.provider).toBe('ollama');
    });

    it('should use cache for repeated requests', async () => {
      const prompt = 'Test prompt for cache';
      
      // First request - cache miss
      const response1 = await llmService.complete(prompt);
      expect(response1.cached).toBeFalsy();
      
      // Second request - cache hit
      const response2 = await llmService.complete(prompt);
      expect(response2.cached).toBe(true);
      expect(response2.content).toBe(response1.content);
    });

    it('should respect cache disable option', async () => {
      const prompt = 'Test prompt no cache';
      const options: CompletionOptions = { useCache: false };
      
      await llmService.complete(prompt, options);
      const response2 = await llmService.complete(prompt, options);
      
      expect(response2.cached).toBeFalsy();
    });
  });

  describe('Chat', () => {
    beforeEach(() => {
      // Mock Ollama chat
      (global.fetch as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('/api/chat')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              model: 'llama2',
              message: { role: 'assistant', content: 'Chat response' },
              done: true,
              prompt_eval_count: 15,
              eval_count: 25
            })
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({})
        });
      });
    });

    it('should handle chat messages', async () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
        { role: 'user', content: 'How are you?' }
      ];
      
      const response = await llmService.chat(messages);
      expect(response.content).toBe('Chat response');
    });
  });

  describe('Fallback Strategy', () => {
    it('should fallback to next provider on failure', async () => {
      // Create service with multiple providers
      const multiProviderConfig: LLMConfig = {
        ...mockConfig,
        providers: [
          { type: 'ollama', enabled: true, priority: 1 },
          { type: 'openai', enabled: true, priority: 2, apiKey: 'test-key' }
        ]
      };
      
      const service = new LLMService(multiProviderConfig);
      
      // Mock Ollama failure and OpenAI success
      (global.fetch as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('localhost:11434')) {
          return Promise.reject(new Error('Ollama unavailable'));
        }
        if (url.includes('api.openai.com')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              choices: [{ message: { content: 'OpenAI response' } }],
              model: 'gpt-4',
              usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }
            })
          });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      });
      
      const response = await service.complete('Test');
      expect(response.provider).toBe('openai');
      expect(response.content).toBe('OpenAI response');
      
      await service.stop();
    });
  });

  describe('Rate Limiting', () => {
    it('should respect rate limits', async () => {
      const limitedConfig: LLMConfig = {
        ...mockConfig,
        rateLimits: {
          ollama: { rpm: 2 } // Very low limit for testing
        }
      };
      
      const service = new LLMService(limitedConfig);
      
      // Mock successful responses
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          response: 'Test',
          done: true
        })
      });
      
      // Make rapid requests
      const promises = [];
      for (let i = 0; i < 3; i++) {
        promises.push(service.complete(`Test ${i}`));
      }
      
      // Third request should be queued due to rate limit
      const start = Date.now();
      await Promise.all(promises);
      const duration = Date.now() - start;
      
      // Should take some time due to rate limiting
      expect(duration).toBeGreaterThan(0);
      
      await service.stop();
    });
  });

  describe('Metrics', () => {
    it('should track metrics', async () => {
      // Mock successful response
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          response: 'Test response',
          done: true,
          prompt_eval_count: 10,
          eval_count: 20
        })
      });
      
      await llmService.complete('Test');
      
      const metrics = llmService.getMetrics();
      const summary = metrics.getSummary();
      
      expect(summary.totalRequests).toBe(1);
      expect(summary.totalSuccess).toBe(1);
      expect(summary.totalFailures).toBe(0);
    });
  });

  describe('Status', () => {
    it('should return service status', () => {
      const status = llmService.getStatus();
      
      expect(status).toHaveProperty('providers');
      expect(status).toHaveProperty('defaultProvider');
      expect(status).toHaveProperty('totalRequests');
      expect(status.defaultProvider).toBe('ollama');
    });
  });
});

describe('LLMCache', () => {
  let cache: LLMCache;
  
  beforeEach(() => {
    cache = new LLMCache({
      ttl: 60000,
      maxSize: 1024
    });
  });
  
  afterEach(() => {
    cache.stop();
  });
  
  it('should cache responses', async () => {
    const response = {
      content: 'Test content',
      provider: 'ollama' as LLMProviderType,
      model: 'llama2'
    };
    
    await cache.set('test', undefined, response);
    const cached = await cache.get('test', undefined);
    
    expect(cached).toBeTruthy();
    expect(cached?.content).toBe('Test content');
  });
  
  it('should respect TTL', async () => {
    const shortCache = new LLMCache({ ttl: 100 }); // 100ms TTL
    
    const response = {
      content: 'Test',
      provider: 'ollama' as LLMProviderType,
      model: 'llama2'
    };
    
    await shortCache.set('test', undefined, response);
    
    // Should exist immediately
    let cached = await shortCache.get('test', undefined);
    expect(cached).toBeTruthy();
    
    // Wait for expiration
    await new Promise(resolve => setTimeout(resolve, 150));
    
    // Should be expired
    cached = await shortCache.get('test', undefined);
    expect(cached).toBeNull();
    
    shortCache.stop();
  });
  
  it('should track cache statistics', async () => {
    const response = {
      content: 'Test',
      provider: 'ollama' as LLMProviderType,
      model: 'llama2'
    };
    
    await cache.set('test', undefined, response);
    await cache.get('test', undefined); // Hit
    await cache.get('missing', undefined); // Miss
    
    const stats = cache.getStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
  });
});

describe('RateLimiter', () => {
  let rateLimiter: RateLimiter;
  
  beforeEach(() => {
    rateLimiter = new RateLimiter({
      ollama: { rpm: 60 },
      openai: { rpm: 30 }
    });
  });
  
  afterEach(() => {
    rateLimiter.stop();
  });
  
  it('should acquire tokens', async () => {
    await expect(rateLimiter.acquire('ollama')).resolves.toBeUndefined();
  });
  
  it('should track provider limits separately', async () => {
    const ollamaAcquire = rateLimiter.tryAcquire('ollama');
    const openaiAcquire = rateLimiter.tryAcquire('openai');
    
    expect(ollamaAcquire).toBe(true);
    expect(openaiAcquire).toBe(true);
  });
  
  it('should handle concurrent limits', () => {
    const limiter = new RateLimiter({
      ollama: { concurrent: 2 }
    });
    
    // First two should succeed
    expect(limiter.tryAcquire('ollama')).toBe(true);
    expect(limiter.tryAcquire('ollama')).toBe(true);
    
    // Third should fail (concurrent limit)
    expect(limiter.tryAcquire('ollama')).toBe(false);
    
    // Release one
    limiter.release('ollama');
    
    // Now should succeed
    expect(limiter.tryAcquire('ollama')).toBe(true);
    
    limiter.stop();
  });
});

describe('ReasoningEngine', () => {
  let llmService: LLMService;
  let reasoningEngine: ReasoningEngine;
  
  beforeEach(() => {
    // Mock LLM responses
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        response: 'Reasoning step result',
        done: true
      })
    });
    
    llmService = new LLMService(mockConfig);
    reasoningEngine = new ReasoningEngine(llmService);
  });
  
  afterEach(async () => {
    await llmService.stop();
  });
  
  it('should perform multi-step reasoning', async () => {
    const chain = await reasoningEngine.reason('Solve a complex problem');
    
    expect(chain.steps).toHaveLength(5);
    expect(chain.steps[0].type).toBe('understand');
    expect(chain.steps[1].type).toBe('decompose');
    expect(chain.steps[2].type).toBe('plan');
    expect(chain.steps[3].type).toBe('execute');
    expect(chain.steps[4].type).toBe('evaluate');
  });
  
  it('should solve problems with constraints', async () => {
    const solution = await reasoningEngine.solveProblem(
      'Find the optimal route',
      ['Must avoid highways', 'Minimize time']
    );
    
    expect(solution).toBeTruthy();
    expect(typeof solution).toBe('string');
  });
  
  it('should perform reflection', async () => {
    const reflection = await reasoningEngine.reflect(
      'Implemented caching',
      'Improved performance by 50%'
    );
    
    expect(reflection).toBeTruthy();
    expect(typeof reflection).toBe('string');
  });
});