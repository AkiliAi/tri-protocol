import { EventEmitter } from 'eventemitter3';
import { LoggerManager } from '@tri-protocol/logger';

/**
 * Configuration for SDK metrics collection
 */
export interface SDKMetricsConfig {
  enabled: boolean;
  collectInterval?: number; // ms
  persistence?: 'memory' | 'redis' | 'prometheus';
  exporters?: MetricExporter[];
}

/**
 * Snapshot of all SDK metrics at a point in time
 */
export interface MetricSnapshot {
  timestamp: Date;

  // Usage metrics
  totalAgentsCreated: number;
  activeAgents: number;
  totalWorkflowsExecuted: number;
  activeWorkflows: number;
  totalQueries: number;

  // Performance metrics
  averageResponseTime: number; // ms
  p50ResponseTime: number;
  p95ResponseTime: number;
  p99ResponseTime: number;

  // Error metrics
  totalErrors: number;
  errorRate: number; // errors per minute
  errorsByType: Record<string, number>;

  // Resource metrics
  memoryUsage: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
  };

  // Protocol usage
  protocolUsage: {
    a2a: number;
    mcp: number;
    langgraph: number;
  };

  // LLM metrics
  llmCalls: {
    total: number;
    byProvider: Record<string, number>;
    cacheHits: number;
    cacheHitRate: number;
    averageTokens: number;
    totalCost?: number;
  };

  // Builder usage
  builderUsage: {
    agentBuilder: number;
    workflowBuilder: number;
    fromTemplate: number;
    fromScratch: number;
  };
}

/**
 * Interface for metric exporters
 */
export interface MetricExporter {
  name: string;
  export(metrics: MetricSnapshot): Promise<void>;
}

/**
 * Interface for metric collectors
 */
export interface MetricCollector {
  name: string;
  collect(): Promise<any>;
}

/**
 * Main SDK Metrics collection and management class
 */
export class SDKMetrics extends EventEmitter {
  private metrics: MetricSnapshot;
  private collectors: MetricCollector[] = [];
  private exporters: MetricExporter[] = [];
  private timers = new Map<string, number>();
  private counters = new Map<string, number>();
  private gauges = new Map<string, number>();
  private histograms = new Map<string, number[]>();
  private errorTimestamps: number[] = [];
  private config: SDKMetricsConfig;
  private collectInterval?: NodeJS.Timeout;
  private logger = LoggerManager.getLogger('SDKMetrics');

  constructor(config: SDKMetricsConfig) {
    super();
    this.config = config;
    this.metrics = this.initializeMetrics();
    this.setupCollectors(config);
    this.setupExporters(config);

    if (config.enabled && config.collectInterval) {
      this.collectInterval = setInterval(() => this.collect(), config.collectInterval);
    }
  }

  /**
   * Initialize empty metrics structure
   */
  private initializeMetrics(): MetricSnapshot {
    return {
      timestamp: new Date(),
      totalAgentsCreated: 0,
      activeAgents: 0,
      totalWorkflowsExecuted: 0,
      activeWorkflows: 0,
      totalQueries: 0,
      averageResponseTime: 0,
      p50ResponseTime: 0,
      p95ResponseTime: 0,
      p99ResponseTime: 0,
      totalErrors: 0,
      errorRate: 0,
      errorsByType: {},
      memoryUsage: process.memoryUsage(),
      protocolUsage: {
        a2a: 0,
        mcp: 0,
        langgraph: 0
      },
      llmCalls: {
        total: 0,
        byProvider: {},
        cacheHits: 0,
        cacheHitRate: 0,
        averageTokens: 0,
        totalCost: 0
      },
      builderUsage: {
        agentBuilder: 0,
        workflowBuilder: 0,
        fromTemplate: 0,
        fromScratch: 0
      }
    };
  }

  /**
   * Setup metric collectors based on configuration
   */
  private setupCollectors(config: SDKMetricsConfig): void {
    // Add default collectors if needed
    // These would be custom collector implementations
  }

  /**
   * Setup metric exporters based on configuration
   */
  private setupExporters(config: SDKMetricsConfig): void {
    if (config.exporters) {
      this.exporters = config.exporters;
    }
  }

  /**
   * Start a timer for performance measurement
   */
  startTimer(operation: string): string {
    const timerId = `${operation}-${Date.now()}-${Math.random()}`;
    this.timers.set(timerId, Date.now());
    return timerId;
  }

  /**
   * End a timer and record the duration
   */
  endTimer(timerId: string): number {
    const start = this.timers.get(timerId);
    if (!start) return 0;

    const duration = Date.now() - start;
    this.timers.delete(timerId);

    // Update response time metrics
    const operation = timerId.split('-')[0];
    this.recordHistogram(`${operation}.duration`, duration);

    return duration;
  }

  /**
   * Increment a counter metric
   */
  incrementCounter(name: string, value: number = 1): void {
    const current = this.counters.get(name) || 0;
    this.counters.set(name, current + value);
    this.emit('metric:counter', { name, value: current + value });
  }

  /**
   * Set a gauge metric
   */
  setGauge(name: string, value: number): void {
    this.gauges.set(name, value);
    this.emit('metric:gauge', { name, value });
  }

  /**
   * Record a value in a histogram
   */
  recordHistogram(name: string, value: number): void {
    const histogram = this.histograms.get(name) || [];
    histogram.push(value);
    this.histograms.set(name, histogram);

    // Keep only last 1000 values for memory efficiency
    if (histogram.length > 1000) {
      histogram.shift();
    }
  }

  /**
   * Record an error occurrence
   */
  recordError(error: Error, context?: any): void {
    this.incrementCounter('errors.total');

    const errorType = error.constructor.name;
    this.incrementCounter(`errors.${errorType}`);

    // Track error timestamps for rate calculation
    this.errorTimestamps.push(Date.now());
    // Keep only last 60 seconds of error timestamps
    const cutoff = Date.now() - 60000;
    this.errorTimestamps = this.errorTimestamps.filter(ts => ts > cutoff);

    this.emit('metric:error', {
      error,
      context,
      timestamp: new Date()
    });
  }

  /**
   * Record LLM call metrics
   */
  recordLLMCall(provider: string, tokens: number, cached: boolean, cost?: number): void {
    this.incrementCounter('llm.total');
    this.incrementCounter(`llm.provider.${provider}`);

    if (cached) {
      this.incrementCounter('llm.cacheHits');
    }

    this.recordHistogram('llm.tokens', tokens);

    if (cost !== undefined) {
      const currentCost = this.gauges.get('llm.totalCost') || 0;
      this.setGauge('llm.totalCost', currentCost + cost);
    }
  }

  /**
   * Calculate average from an array of numbers
   */
  private calculateAverage(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  /**
   * Calculate percentile from an array of numbers
   */
  private calculatePercentile(values: number[], percentile: number): number {
    if (values.length === 0) return 0;

    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  /**
   * Calculate rate (per minute) for a metric
   */
  private calculateRate(metricName: string): number {
    if (metricName === 'errors.total') {
      return this.errorTimestamps.length; // Already filtered to last minute
    }

    // For other metrics, would need timestamp tracking
    return 0;
  }

  /**
   * Get errors grouped by type
   */
  private getErrorsByType(): Record<string, number> {
    const errorsByType: Record<string, number> = {};

    for (const [key, value] of this.counters.entries()) {
      if (key.startsWith('errors.') && key !== 'errors.total') {
        const errorType = key.replace('errors.', '');
        errorsByType[errorType] = value;
      }
    }

    return errorsByType;
  }

  /**
   * Get LLM metrics
   */
  private getLLMMetrics(): MetricSnapshot['llmCalls'] {
    const total = this.counters.get('llm.total') || 0;
    const cacheHits = this.counters.get('llm.cacheHits') || 0;
    const tokens = this.histograms.get('llm.tokens') || [];

    const byProvider: Record<string, number> = {};
    for (const [key, value] of this.counters.entries()) {
      if (key.startsWith('llm.provider.')) {
        const provider = key.replace('llm.provider.', '');
        byProvider[provider] = value;
      }
    }

    return {
      total,
      byProvider,
      cacheHits,
      cacheHitRate: total > 0 ? (cacheHits / total) * 100 : 0,
      averageTokens: this.calculateAverage(tokens),
      totalCost: this.gauges.get('llm.totalCost')
    };
  }

  /**
   * Get builder metrics
   */
  private getBuilderMetrics(): MetricSnapshot['builderUsage'] {
    return {
      agentBuilder: this.counters.get('builders.agent') || 0,
      workflowBuilder: this.counters.get('builders.workflow') || 0,
      fromTemplate: this.counters.get('builders.fromTemplate') || 0,
      fromScratch: this.counters.get('builders.fromScratch') || 0
    };
  }

  /**
   * Collect all metrics and create a snapshot
   */
  async collect(): Promise<MetricSnapshot> {
    const responseTimes = this.histograms.get('query.duration') || [];

    this.metrics = {
      timestamp: new Date(),

      // Usage metrics from counters
      totalAgentsCreated: this.counters.get('agents.created') || 0,
      activeAgents: this.gauges.get('agents.active') || 0,
      totalWorkflowsExecuted: this.counters.get('workflows.executed') || 0,
      activeWorkflows: this.gauges.get('workflows.active') || 0,
      totalQueries: this.counters.get('queries.total') || 0,

      // Performance metrics
      averageResponseTime: this.calculateAverage(responseTimes),
      p50ResponseTime: this.calculatePercentile(responseTimes, 50),
      p95ResponseTime: this.calculatePercentile(responseTimes, 95),
      p99ResponseTime: this.calculatePercentile(responseTimes, 99),

      // Error metrics
      totalErrors: this.counters.get('errors.total') || 0,
      errorRate: this.calculateRate('errors.total'),
      errorsByType: this.getErrorsByType(),

      // Memory metrics
      memoryUsage: process.memoryUsage(),

      // Protocol usage
      protocolUsage: {
        a2a: this.counters.get('protocol.a2a') || 0,
        mcp: this.counters.get('protocol.mcp') || 0,
        langgraph: this.counters.get('protocol.langgraph') || 0
      },

      // LLM metrics
      llmCalls: this.getLLMMetrics(),

      // Builder usage
      builderUsage: this.getBuilderMetrics()
    };

    // Export metrics to all configured exporters
    for (const exporter of this.exporters) {
      try {
        await exporter.export(this.metrics);
      } catch (error) {
        this.logger.error(`Failed to export metrics via ${exporter.name}:`, error);
      }
    }

    this.emit('metrics:collected', this.metrics);

    return this.metrics;
  }

  /**
   * Get current metrics snapshot without collecting
   */
  getSnapshot(): MetricSnapshot {
    return { ...this.metrics };
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
    this.timers.clear();
    this.errorTimestamps = [];
    this.metrics = this.initializeMetrics();
  }

  /**
   * Add a new exporter
   */
  addExporter(exporter: MetricExporter): void {
    this.exporters.push(exporter);
  }

  /**
   * Remove an exporter by name
   */
  removeExporter(name: string): void {
    this.exporters = this.exporters.filter(e => e.name !== name);
  }

  /**
   * Stop metric collection
   */
  stop(): void {
    if (this.collectInterval) {
      clearInterval(this.collectInterval);
      this.collectInterval = undefined;
    }
  }

  /**
   * Check if metrics collection is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }
}