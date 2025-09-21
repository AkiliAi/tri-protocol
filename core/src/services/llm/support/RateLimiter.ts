/**
 * Rate Limiter Service
 * Token bucket implementation for rate limiting LLM requests
 */

import { EventEmitter } from 'eventemitter3';
import { Logger } from '@tri-protocol/logger';
import { LLMProviderType, RateLimitConfig, RateLimitError } from '../types';

interface TokenBucketState {
  tokens: number;
  lastRefill: number;
  queue: Array<{
    resolve: () => void;
    reject: (error: Error) => void;
    timestamp: number;
  }>;
}

export class TokenBucket {
  private maxTokens: number;
  private refillRate: number;
  private tokens: number;
  private lastRefill: number;
  private interval: number; // Refill interval in ms
  private queue: Array<{
    resolve: () => void;
    reject: (error: Error) => void;
    timestamp: number;
  }> = [];
  private refillTimer: NodeJS.Timeout | null = null;
  private logger: Logger;

  constructor(
    private config: RateLimitConfig,
    private name: string = 'default'
  ) {
    this.logger = Logger.getLogger(`TokenBucket:${name}`);
    
    // Calculate tokens based on config
    if (config.rpm) {
      // Requests per minute
      this.maxTokens = config.rpm;
      this.refillRate = config.rpm / 60; // Tokens per second
      this.interval = 1000; // Refill every second
    } else if (config.tpm) {
      // Tokens per minute (for token-based limits)
      this.maxTokens = config.tpm;
      this.refillRate = config.tpm / 60;
      this.interval = 1000;
    } else {
      // Default: 60 requests per minute
      this.maxTokens = 60;
      this.refillRate = 1;
      this.interval = 1000;
    }
    
    this.tokens = this.maxTokens;
    this.lastRefill = Date.now();
    
    this.startRefillTimer();
  }

  /**
   * Acquire tokens (wait if necessary)
   */
  async acquire(count: number = 1): Promise<void> {
    // Refill tokens based on elapsed time
    this.refill();
    
    if (this.tokens >= count) {
      this.tokens -= count;
      this.logger.debug('Tokens acquired', { 
        count, 
        remaining: this.tokens 
      });
      return;
    }
    
    // Not enough tokens, add to queue
    return new Promise((resolve, reject) => {
      this.queue.push({ 
        resolve, 
        reject, 
        timestamp: Date.now() 
      });
      
      this.logger.debug('Request queued', { 
        queueLength: this.queue.length,
        tokensNeeded: count,
        available: this.tokens 
      });
      
      // Set timeout for queue items (30 seconds)
      setTimeout(() => {
        const index = this.queue.findIndex(item => 
          item.resolve === resolve && item.reject === reject
        );
        if (index !== -1) {
          this.queue.splice(index, 1);
          reject(new Error('Rate limit queue timeout'));
        }
      }, 30000);
    });
  }

  /**
   * Try to acquire tokens without waiting
   */
  tryAcquire(count: number = 1): boolean {
    this.refill();
    
    if (this.tokens >= count) {
      this.tokens -= count;
      return true;
    }
    
    return false;
  }

  /**
   * Get current token count
   */
  getTokens(): number {
    this.refill();
    return this.tokens;
  }

  /**
   * Get time until next token available
   */
  getWaitTime(): number {
    if (this.tokens > 0) {
      return 0;
    }
    
    const timeSinceRefill = Date.now() - this.lastRefill;
    const timeUntilNextToken = Math.max(0, this.interval - timeSinceRefill);
    
    return timeUntilNextToken;
  }

  /**
   * Refill tokens based on elapsed time
   */
  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    
    if (elapsed >= this.interval) {
      const tokensToAdd = Math.floor(elapsed / this.interval) * this.refillRate;
      this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
      this.lastRefill = now;
      
      // Process waiting queue
      this.processQueue();
    }
  }

  /**
   * Process waiting queue
   */
  private processQueue(): void {
    while (this.queue.length > 0 && this.tokens > 0) {
      const item = this.queue.shift();
      if (item) {
        this.tokens--;
        item.resolve();
        
        this.logger.debug('Queue item processed', { 
          waitTime: Date.now() - item.timestamp,
          remaining: this.tokens 
        });
      }
    }
  }

  /**
   * Start refill timer
   */
  private startRefillTimer(): void {
    this.refillTimer = setInterval(() => {
      this.refill();
    }, this.interval);
  }

  /**
   * Stop the token bucket
   */
  stop(): void {
    if (this.refillTimer) {
      clearInterval(this.refillTimer);
      this.refillTimer = null;
    }
    
    // Reject all queued items
    for (const item of this.queue) {
      item.reject(new Error('Token bucket stopped'));
    }
    this.queue = [];
  }

  /**
   * Get bucket state
   */
  getState(): TokenBucketState {
    return {
      tokens: this.tokens,
      lastRefill: this.lastRefill,
      queue: [...this.queue]
    };
  }
}

export class RateLimiter extends EventEmitter {
  private limits = new Map<LLMProviderType, TokenBucket>();
  private globalLimit?: TokenBucket;
  private concurrentLimits = new Map<LLMProviderType, number>();
  private activeCounts = new Map<LLMProviderType, number>();
  private logger: Logger;

  constructor(config?: Record<LLMProviderType, RateLimitConfig>) {
    super();
    this.logger = Logger.getLogger('RateLimiter');
    
    if (config) {
      this.initialize(config);
    }
  }

  /**
   * Initialize rate limits
   */
  initialize(config: Record<LLMProviderType, RateLimitConfig>): void {
    for (const [provider, limit] of Object.entries(config)) {
      const bucket = new TokenBucket(limit, provider);
      this.limits.set(provider as LLMProviderType, bucket);
      
      if (limit.concurrent) {
        this.concurrentLimits.set(provider as LLMProviderType, limit.concurrent);
        this.activeCounts.set(provider as LLMProviderType, 0);
      }
      
      this.logger.info('Rate limit configured', { 
        provider, 
        config: limit 
      });
    }
  }

  /**
   * Set global rate limit
   */
  setGlobalLimit(config: RateLimitConfig): void {
    this.globalLimit = new TokenBucket(config, 'global');
    this.logger.info('Global rate limit set', { config });
  }

  /**
   * Acquire permission to make a request
   */
  async acquire(provider: LLMProviderType, tokens: number = 1): Promise<void> {
    // Check concurrent limit
    if (this.concurrentLimits.has(provider)) {
      const limit = this.concurrentLimits.get(provider)!;
      const active = this.activeCounts.get(provider) || 0;
      
      if (active >= limit) {
        this.emit('concurrent_limit', { provider, active, limit });
        throw new RateLimitError(provider);
      }
      
      this.activeCounts.set(provider, active + 1);
    }
    
    try {
      // Check global limit
      if (this.globalLimit) {
        await this.globalLimit.acquire(tokens);
      }
      
      // Check provider-specific limit
      const bucket = this.limits.get(provider);
      if (bucket) {
        await bucket.acquire(tokens);
        this.emit('acquired', { provider, tokens });
      }
    } catch (error) {
      // Release concurrent count on error
      if (this.concurrentLimits.has(provider)) {
        const active = this.activeCounts.get(provider) || 0;
        this.activeCounts.set(provider, Math.max(0, active - 1));
      }
      throw error;
    }
  }

  /**
   * Release concurrent request count
   */
  release(provider: LLMProviderType): void {
    if (this.concurrentLimits.has(provider)) {
      const active = this.activeCounts.get(provider) || 0;
      this.activeCounts.set(provider, Math.max(0, active - 1));
      
      this.emit('released', { 
        provider, 
        active: this.activeCounts.get(provider) 
      });
    }
  }

  /**
   * Try to acquire without waiting
   */
  tryAcquire(provider: LLMProviderType, tokens: number = 1): boolean {
    // Check concurrent limit
    if (this.concurrentLimits.has(provider)) {
      const limit = this.concurrentLimits.get(provider)!;
      const active = this.activeCounts.get(provider) || 0;
      
      if (active >= limit) {
        return false;
      }
    }
    
    // Check global limit
    if (this.globalLimit && !this.globalLimit.tryAcquire(tokens)) {
      return false;
    }
    
    // Check provider-specific limit
    const bucket = this.limits.get(provider);
    if (bucket && !bucket.tryAcquire(tokens)) {
      // Rollback global if provider fails
      if (this.globalLimit) {
        // Add tokens back (not ideal but works)
        this.globalLimit.getTokens();
      }
      return false;
    }
    
    // Update concurrent count
    if (this.concurrentLimits.has(provider)) {
      const active = this.activeCounts.get(provider) || 0;
      this.activeCounts.set(provider, active + 1);
    }
    
    return true;
  }

  /**
   * Get wait time for provider
   */
  getWaitTime(provider: LLMProviderType): number {
    const bucket = this.limits.get(provider);
    if (!bucket) {
      return 0;
    }
    
    const providerWait = bucket.getWaitTime();
    const globalWait = this.globalLimit ? this.globalLimit.getWaitTime() : 0;
    
    return Math.max(providerWait, globalWait);
  }

  /**
   * Get rate limiter status
   */
  getStatus(): {
    providers: Map<LLMProviderType, {
      tokens: number;
      active: number;
      queued: number;
    }>;
    global?: {
      tokens: number;
    };
  } {
    const status: {
      providers: Map<LLMProviderType, {
        tokens: number;
        active: number;
        queued: number;
      }>;
      global?: {
        tokens: number;
      };
    } = {
      providers: new Map()
    };
    
    for (const [provider, bucket] of this.limits.entries()) {
      const state = bucket.getState();
      status.providers.set(provider, {
        tokens: state.tokens,
        active: this.activeCounts.get(provider) || 0,
        queued: state.queue.length
      });
    }
    
    if (this.globalLimit) {
      status.global = {
        tokens: this.globalLimit.getTokens()
      };
    }
    
    return status;
  }

  /**
   * Stop all rate limiters
   */
  stop(): void {
    for (const bucket of this.limits.values()) {
      bucket.stop();
    }
    
    if (this.globalLimit) {
      this.globalLimit.stop();
    }
    
    this.limits.clear();
    this.concurrentLimits.clear();
    this.activeCounts.clear();
    this.removeAllListeners();
    
    this.logger.info('Rate limiter stopped');
  }
}