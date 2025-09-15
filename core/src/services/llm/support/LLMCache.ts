/**
 * LLM Cache Service
 * Caching layer for LLM responses to improve performance and reduce costs
 */

import * as crypto from 'crypto';
import { EventEmitter } from 'eventemitter3';
import { Logger } from '@tri-protocol/logger';
import {
  LLMResponse,
  CompletionOptions,
  CacheConfig,
  CacheEntry,
  CacheStats
} from '../types';

interface CacheItem {
  key: string;
  entry: CacheEntry;
  size: number;
  accessCount: number;
  lastAccessed: number;
}

export class LLMCache extends EventEmitter {
  private cache: Map<string, CacheItem> = new Map();
  private ttl: number;
  private maxSize: number;
  private currentSize: number = 0;
  private strategy: 'lru' | 'fifo';
  private cleanupInterval: NodeJS.Timeout | null = null;
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    size: 0,
    evictions: 0
  };
  private logger: Logger;

  constructor(config: CacheConfig = {}) {
    super();
    this.ttl = config.ttl || 3600000; // 1 hour default
    this.maxSize = config.maxSize || 100 * 1024 * 1024; // 100MB default
    this.strategy = config.strategy || 'lru';
    this.logger = Logger.getLogger('LLMCache');
    
    this.startCleanupTimer();
  }

  /**
   * Get cached response
   */
  async get(prompt: string, options?: CompletionOptions): Promise<LLMResponse | null> {
    const key = this.generateKey(prompt, options);
    const item = this.cache.get(key);
    
    if (!item) {
      this.stats.misses++;
      this.emit('miss', { key, prompt });
      return null;
    }
    
    // Check if expired
    if (Date.now() - item.entry.timestamp > this.ttl) {
      this.delete(key);
      this.stats.misses++;
      this.emit('expired', { key, prompt });
      return null;
    }
    
    // Update access metadata
    item.accessCount++;
    item.lastAccessed = Date.now();
    item.entry.hits = (item.entry.hits || 0) + 1;
    
    this.stats.hits++;
    this.emit('hit', { key, prompt, response: item.entry.response });
    
    this.logger.debug('Cache hit', { 
      key, 
      accessCount: item.accessCount,
      age: Date.now() - item.entry.timestamp 
    });
    
    return { ...item.entry.response, cached: true };
  }

  /**
   * Set cached response
   */
  async set(
    prompt: string, 
    options: CompletionOptions | undefined, 
    response: LLMResponse
  ): Promise<void> {
    const key = this.generateKey(prompt, options);
    const size = this.estimateSize(response);
    
    // Check if we need to evict items
    if (this.currentSize + size > this.maxSize) {
      await this.evict(size);
    }
    
    const entry: CacheEntry = {
      response,
      timestamp: Date.now(),
      hits: 0
    };
    
    const item: CacheItem = {
      key,
      entry,
      size,
      accessCount: 0,
      lastAccessed: Date.now()
    };
    
    // Remove old entry if exists
    const oldItem = this.cache.get(key);
    if (oldItem) {
      this.currentSize -= oldItem.size;
    }
    
    this.cache.set(key, item);
    this.currentSize += size;
    this.stats.size = this.cache.size;
    
    this.emit('set', { key, prompt, response });
    
    this.logger.debug('Cache set', { 
      key, 
      size, 
      totalSize: this.currentSize,
      itemCount: this.cache.size 
    });
  }

  /**
   * Delete cached entry
   */
  delete(key: string): boolean {
    const item = this.cache.get(key);
    if (!item) {
      return false;
    }
    
    this.cache.delete(key);
    this.currentSize -= item.size;
    this.stats.size = this.cache.size;
    
    this.emit('delete', { key });
    
    return true;
  }

  /**
   * Clear all cached entries
   */
  clear(): void {
    const previousSize = this.cache.size;
    this.cache.clear();
    this.currentSize = 0;
    this.stats.size = 0;
    
    this.emit('clear', { itemsCleared: previousSize });
    
    this.logger.info('Cache cleared', { itemsCleared: previousSize });
  }

  /**
   * Generate cache key
   */
  private generateKey(prompt: string, options?: CompletionOptions): string {
    const hash = crypto.createHash('sha256');
    hash.update(prompt);
    
    if (options) {
      // Include relevant options in the key
      const keyOptions = {
        provider: options.provider,
        model: options.model,
        temperature: options.temperature,
        maxTokens: options.maxTokens,
        topP: options.topP,
        topK: options.topK,
        systemPrompt: options.systemPrompt,
        format: options.format
      };
      hash.update(JSON.stringify(keyOptions));
    }
    
    return hash.digest('hex');
  }

  /**
   * Estimate size of a response in bytes
   */
  private estimateSize(response: LLMResponse): number {
    // Rough estimation based on JSON string length
    const jsonString = JSON.stringify(response);
    return Buffer.byteLength(jsonString, 'utf8');
  }

  /**
   * Evict items based on strategy
   */
  private async evict(requiredSpace: number): Promise<void> {
    const itemsToEvict: string[] = [];
    let freedSpace = 0;
    
    // Get sorted items based on strategy
    const sortedItems = this.getSortedItemsForEviction();
    
    for (const item of sortedItems) {
      if (freedSpace >= requiredSpace) {
        break;
      }
      
      itemsToEvict.push(item.key);
      freedSpace += item.size;
    }
    
    // Evict items
    for (const key of itemsToEvict) {
      this.delete(key);
      this.stats.evictions++;
    }
    
    if (itemsToEvict.length > 0) {
      this.emit('eviction', { 
        evictedCount: itemsToEvict.length, 
        freedSpace 
      });
      
      this.logger.debug('Cache eviction', { 
        evictedCount: itemsToEvict.length, 
        freedSpace,
        strategy: this.strategy 
      });
    }
  }

  /**
   * Get items sorted for eviction based on strategy
   */
  private getSortedItemsForEviction(): CacheItem[] {
    const items = Array.from(this.cache.values());
    
    if (this.strategy === 'lru') {
      // Least Recently Used
      return items.sort((a, b) => a.lastAccessed - b.lastAccessed);
    } else {
      // FIFO - First In First Out
      return items.sort((a, b) => a.entry.timestamp - b.entry.timestamp);
    }
  }

  /**
   * Start cleanup timer
   */
  private startCleanupTimer(): void {
    // Run cleanup every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000);
  }

  /**
   * Cleanup expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];
    
    for (const [key, item] of this.cache.entries()) {
      if (now - item.entry.timestamp > this.ttl) {
        keysToDelete.push(key);
      }
    }
    
    for (const key of keysToDelete) {
      this.delete(key);
    }
    
    if (keysToDelete.length > 0) {
      this.logger.debug('Cache cleanup', { 
        expiredCount: keysToDelete.length 
      });
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return {
      ...this.stats,
      size: this.cache.size
    };
  }

  /**
   * Get cache info
   */
  getInfo(): {
    stats: CacheStats;
    config: {
      ttl: number;
      maxSize: number;
      strategy: 'lru' | 'fifo';
    };
    memory: {
      used: number;
      max: number;
      percentage: number;
    };
  } {
    return {
      stats: this.getStats(),
      config: {
        ttl: this.ttl,
        maxSize: this.maxSize,
        strategy: this.strategy
      },
      memory: {
        used: this.currentSize,
        max: this.maxSize,
        percentage: (this.currentSize / this.maxSize) * 100
      }
    };
  }

  /**
   * Stop the cache (cleanup resources)
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    
    this.clear();
    this.removeAllListeners();
    
    this.logger.info('Cache stopped');
  }
}