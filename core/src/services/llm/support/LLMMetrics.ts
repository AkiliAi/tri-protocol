/**
 * LLM Metrics Service
 * Tracks performance metrics for LLM providers
 */

import { EventEmitter } from 'eventemitter3';
// @ts-ignore
import { Logger } from '@tri-protocol/logger';
import { LLMProviderType, LLMMetrics as ILLMMetrics } from '../types';

interface MetricData {
  provider: LLMProviderType;
  timestamp: number;
  latency: number;
  success: boolean;
  tokens?: {
    prompt: number;
    completion: number;
    total: number;
  };
  error?: string;
}

interface ProviderMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  totalLatency: number;
  minLatency: number;
  maxLatency: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  errors: Map<string, number>;
  lastRequestTime?: number;
  lastError?: string;
}

export class LLMMetrics extends EventEmitter {
  private metrics = new Map<LLMProviderType, ProviderMetrics>();
  private history: MetricData[] = [];
  private maxHistorySize: number = 1000;
  private logger: Logger;
  private startTime: number;

  constructor() {
    super();
    this.logger = Logger.getLogger('LLMMetrics');
    this.startTime = Date.now();
  }

  /**
   * Record a completion request
   */
  recordCompletion(
    provider: LLMProviderType,
    latency: number,
    success: boolean,
    tokens?: { prompt: number; completion: number; total: number },
    error?: string
  ): void {
    // Get or create provider metrics
    let providerMetrics = this.metrics.get(provider);
    if (!providerMetrics) {
      providerMetrics = this.createEmptyMetrics();
      this.metrics.set(provider, providerMetrics);
    }

    // Update metrics
    providerMetrics.totalRequests++;
    providerMetrics.totalLatency += latency;
    providerMetrics.lastRequestTime = Date.now();

    if (success) {
      providerMetrics.successfulRequests++;
      providerMetrics.minLatency = Math.min(providerMetrics.minLatency, latency);
      providerMetrics.maxLatency = Math.max(providerMetrics.maxLatency, latency);

      if (tokens) {
        providerMetrics.totalTokens += tokens.total;
        providerMetrics.promptTokens += tokens.prompt;
        providerMetrics.completionTokens += tokens.completion;
      }
    } else {
      providerMetrics.failedRequests++;
      providerMetrics.lastError = error;
      
      if (error) {
        const errorCount = providerMetrics.errors.get(error) || 0;
        providerMetrics.errors.set(error, errorCount + 1);
      }
    }

    // Add to history
    const metricData: MetricData = {
      provider,
      timestamp: Date.now(),
      latency,
      success,
      tokens,
      error
    };
    
    this.history.push(metricData);
    
    // Trim history if needed
    if (this.history.length > this.maxHistorySize) {
      this.history = this.history.slice(-this.maxHistorySize);
    }

    // Emit event
    this.emit('metric', metricData);

    this.logger.debug('Metric recorded', {
      provider,
      success,
      latency,
      tokens
    });
  }

  /**
   * Get metrics for a specific provider
   */
  getProviderMetrics(provider: LLMProviderType): ILLMMetrics | null {
    const metrics = this.metrics.get(provider);
    if (!metrics) {
      return null;
    }

    return {
      provider,
      totalRequests: metrics.totalRequests,
      successfulRequests: metrics.successfulRequests,
      failedRequests: metrics.failedRequests,
      averageLatency: metrics.totalRequests > 0 
        ? metrics.totalLatency / metrics.totalRequests 
        : 0,
      totalTokens: metrics.totalTokens,
      cacheHits: 0, // Will be updated from cache
      cacheMisses: 0 // Will be updated from cache
    };
  }

  /**
   * Get all provider metrics
   */
  getAllMetrics(): Map<LLMProviderType, ILLMMetrics> {
    const allMetrics = new Map<LLMProviderType, ILLMMetrics>();
    
    for (const [provider, metrics] of this.metrics.entries()) {
      allMetrics.set(provider, {
        provider,
        totalRequests: metrics.totalRequests,
        successfulRequests: metrics.successfulRequests,
        failedRequests: metrics.failedRequests,
        averageLatency: metrics.totalRequests > 0 
          ? metrics.totalLatency / metrics.totalRequests 
          : 0,
        totalTokens: metrics.totalTokens,
        cacheHits: 0,
        cacheMisses: 0
      });
    }
    
    return allMetrics;
  }

  /**
   * Get total requests across all providers
   */
  getTotalRequests(): number {
    let total = 0;
    for (const metrics of this.metrics.values()) {
      total += metrics.totalRequests;
    }
    return total;
  }

  /**
   * Get success rate for a provider
   */
  getSuccessRate(provider: LLMProviderType): number {
    const metrics = this.metrics.get(provider);
    if (!metrics || metrics.totalRequests === 0) {
      return 0;
    }
    
    return (metrics.successfulRequests / metrics.totalRequests) * 100;
  }

  /**
   * Get average latency for a provider
   */
  getAverageLatency(provider: LLMProviderType): number {
    const metrics = this.metrics.get(provider);
    if (!metrics || metrics.totalRequests === 0) {
      return 0;
    }
    
    return metrics.totalLatency / metrics.totalRequests;
  }

  /**
   * Get recent history
   */
  getHistory(limit?: number): MetricData[] {
    if (limit) {
      return this.history.slice(-limit);
    }
    return [...this.history];
  }

  /**
   * Get provider rankings by success rate
   */
  getProviderRankings(): Array<{
    provider: LLMProviderType;
    successRate: number;
    averageLatency: number;
    totalRequests: number;
  }> {
    const rankings: Array<{
      provider: LLMProviderType;
      successRate: number;
      averageLatency: number;
      totalRequests: number;
    }> = [];
    
    for (const [provider, metrics] of this.metrics.entries()) {
      if (metrics.totalRequests > 0) {
        rankings.push({
          provider,
          successRate: (metrics.successfulRequests / metrics.totalRequests) * 100,
          averageLatency: metrics.totalLatency / metrics.totalRequests,
          totalRequests: metrics.totalRequests
        });
      }
    }
    
    // Sort by success rate, then by average latency
    rankings.sort((a, b) => {
      if (Math.abs(a.successRate - b.successRate) > 0.1) {
        return b.successRate - a.successRate;
      }
      return a.averageLatency - b.averageLatency;
    });
    
    return rankings;
  }

  /**
   * Get summary statistics
   */
  getSummary(): {
    uptime: number;
    totalRequests: number;
    totalSuccess: number;
    totalFailures: number;
    overallSuccessRate: number;
    totalTokensUsed: number;
    providersUsed: number;
    bestProvider?: LLMProviderType;
    worstProvider?: LLMProviderType;
  } {
    let totalRequests = 0;
    let totalSuccess = 0;
    let totalFailures = 0;
    let totalTokens = 0;
    let bestProvider: LLMProviderType | undefined;
    let worstProvider: LLMProviderType | undefined;
    let bestSuccessRate = 0;
    let worstSuccessRate = 100;
    
    for (const [provider, metrics] of this.metrics.entries()) {
      totalRequests += metrics.totalRequests;
      totalSuccess += metrics.successfulRequests;
      totalFailures += metrics.failedRequests;
      totalTokens += metrics.totalTokens;
      
      if (metrics.totalRequests > 0) {
        const successRate = (metrics.successfulRequests / metrics.totalRequests) * 100;
        
        if (successRate > bestSuccessRate) {
          bestSuccessRate = successRate;
          bestProvider = provider;
        }
        
        if (successRate < worstSuccessRate) {
          worstSuccessRate = successRate;
          worstProvider = provider;
        }
      }
    }
    
    return {
      uptime: Date.now() - this.startTime,
      totalRequests,
      totalSuccess,
      totalFailures,
      overallSuccessRate: totalRequests > 0 
        ? (totalSuccess / totalRequests) * 100 
        : 0,
      totalTokensUsed: totalTokens,
      providersUsed: this.metrics.size,
      bestProvider,
      worstProvider
    };
  }

  /**
   * Reset metrics for a provider
   */
  resetProvider(provider: LLMProviderType): void {
    this.metrics.delete(provider);
    this.emit('reset', { provider });
    this.logger.info('Provider metrics reset', { provider });
  }

  /**
   * Reset all metrics
   */
  resetAll(): void {
    this.metrics.clear();
    this.history = [];
    this.startTime = Date.now();
    this.emit('reset', { provider: 'all' });
    this.logger.info('All metrics reset');
  }

  /**
   * Create empty metrics object
   */
  private createEmptyMetrics(): ProviderMetrics {
    return {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      totalLatency: 0,
      minLatency: Infinity,
      maxLatency: 0,
      totalTokens: 0,
      promptTokens: 0,
      completionTokens: 0,
      errors: new Map()
    };
  }

  /**
   * Export metrics to JSON
   */
  toJSON(): any {
    const metricsObj: any = {};
    
    for (const [provider, metrics] of this.metrics.entries()) {
      metricsObj[provider] = {
        ...metrics,
        errors: Array.from(metrics.errors.entries())
      };
    }
    
    return {
      startTime: this.startTime,
      uptime: Date.now() - this.startTime,
      metrics: metricsObj,
      summary: this.getSummary()
    };
  }
}