import { MetricExporter, MetricSnapshot } from '../SDKMetrics';
import { LoggerManager } from '@tri-protocol/logger';

/**
 * Prometheus exporter for SDK metrics
 * Formats metrics in Prometheus exposition format
 */
export class PrometheusExporter implements MetricExporter {
  name = 'prometheus';
  private metrics: Map<string, PrometheusMetric> = new Map();
  private logger = LoggerManager.getLogger('PrometheusExporter');
  private config: PrometheusConfig;

  constructor(config: PrometheusConfig = {}) {
    this.config = {
      prefix: config.prefix || 'tri_protocol_sdk',
      labels: config.labels || {},
      ...config
    };
    this.initializeMetrics();
  }

  private initializeMetrics(): void {
    const prefix = this.config.prefix;

    // Define all metrics with their types and help text
    this.defineMetric(`${prefix}_agents_created_total`, 'counter',
      'Total number of agents created');
    this.defineMetric(`${prefix}_agents_active`, 'gauge',
      'Number of currently active agents');
    this.defineMetric(`${prefix}_workflows_executed_total`, 'counter',
      'Total number of workflows executed');
    this.defineMetric(`${prefix}_workflows_active`, 'gauge',
      'Number of currently active workflows');
    this.defineMetric(`${prefix}_queries_total`, 'counter',
      'Total number of queries processed');

    this.defineMetric(`${prefix}_response_duration_seconds`, 'histogram',
      'Response time in seconds');

    this.defineMetric(`${prefix}_errors_total`, 'counter',
      'Total number of errors');

    this.defineMetric(`${prefix}_memory_heap_used_bytes`, 'gauge',
      'Memory heap used in bytes');
    this.defineMetric(`${prefix}_memory_heap_total_bytes`, 'gauge',
      'Memory heap total in bytes');
    this.defineMetric(`${prefix}_memory_rss_bytes`, 'gauge',
      'Memory RSS in bytes');

    this.defineMetric(`${prefix}_protocol_usage_total`, 'counter',
      'Protocol usage by type');

    this.defineMetric(`${prefix}_llm_calls_total`, 'counter',
      'Total LLM calls');
    this.defineMetric(`${prefix}_llm_cache_hits_total`, 'counter',
      'LLM cache hits');
    this.defineMetric(`${prefix}_llm_tokens_total`, 'counter',
      'Total tokens processed');
    this.defineMetric(`${prefix}_llm_cost_dollars`, 'gauge',
      'Total LLM cost in dollars');

    this.defineMetric(`${prefix}_builders_usage_total`, 'counter',
      'Builder usage by type');
  }

  private defineMetric(name: string, type: MetricType, help: string): void {
    this.metrics.set(name, {
      name,
      type,
      help,
      value: 0,
      labels: {}
    });
  }

  async export(metrics: MetricSnapshot): Promise<void> {
    try {
      const prefix = this.config.prefix;

      // Update counter metrics
      this.updateMetric(`${prefix}_agents_created_total`, metrics.totalAgentsCreated);
      this.updateMetric(`${prefix}_agents_active`, metrics.activeAgents);
      this.updateMetric(`${prefix}_workflows_executed_total`, metrics.totalWorkflowsExecuted);
      this.updateMetric(`${prefix}_workflows_active`, metrics.activeWorkflows);
      this.updateMetric(`${prefix}_queries_total`, metrics.totalQueries);
      this.updateMetric(`${prefix}_errors_total`, metrics.totalErrors);

      // Update gauge metrics
      this.updateMetric(`${prefix}_memory_heap_used_bytes`, metrics.memoryUsage.heapUsed);
      this.updateMetric(`${prefix}_memory_heap_total_bytes`, metrics.memoryUsage.heapTotal);
      this.updateMetric(`${prefix}_memory_rss_bytes`, metrics.memoryUsage.rss);

      // Update histogram metrics
      this.updateHistogram(`${prefix}_response_duration_seconds`, {
        avg: metrics.averageResponseTime / 1000,
        p50: metrics.p50ResponseTime / 1000,
        p95: metrics.p95ResponseTime / 1000,
        p99: metrics.p99ResponseTime / 1000
      });

      // Update protocol usage with labels
      this.updateMetricWithLabel(`${prefix}_protocol_usage_total`,
        metrics.protocolUsage.a2a, { protocol: 'a2a' });
      this.updateMetricWithLabel(`${prefix}_protocol_usage_total`,
        metrics.protocolUsage.mcp, { protocol: 'mcp' });
      this.updateMetricWithLabel(`${prefix}_protocol_usage_total`,
        metrics.protocolUsage.langgraph, { protocol: 'langgraph' });

      // Update LLM metrics
      this.updateMetric(`${prefix}_llm_calls_total`, metrics.llmCalls.total);
      this.updateMetric(`${prefix}_llm_cache_hits_total`, metrics.llmCalls.cacheHits);

      // Update LLM by provider with labels
      for (const [provider, count] of Object.entries(metrics.llmCalls.byProvider)) {
        this.updateMetricWithLabel(`${prefix}_llm_calls_total`, count, { provider });
      }

      if (metrics.llmCalls.totalCost !== undefined) {
        this.updateMetric(`${prefix}_llm_cost_dollars`, metrics.llmCalls.totalCost);
      }

      // Update builder metrics with labels
      this.updateMetricWithLabel(`${prefix}_builders_usage_total`,
        metrics.builderUsage.agentBuilder, { type: 'agent' });
      this.updateMetricWithLabel(`${prefix}_builders_usage_total`,
        metrics.builderUsage.workflowBuilder, { type: 'workflow' });
      this.updateMetricWithLabel(`${prefix}_builders_usage_total`,
        metrics.builderUsage.fromTemplate, { type: 'template' });
      this.updateMetricWithLabel(`${prefix}_builders_usage_total`,
        metrics.builderUsage.fromScratch, { type: 'scratch' });

      this.logger.debug('Prometheus metrics updated successfully');
    } catch (error) {
      this.logger.error('Failed to export Prometheus metrics:', error);
      throw error;
    }
  }

  private updateMetric(name: string, value: number): void {
    const metric = this.metrics.get(name);
    if (metric) {
      metric.value = value;
    }
  }

  private updateMetricWithLabel(name: string, value: number, labels: Record<string, string>): void {
    const key = `${name}${this.formatLabels(labels)}`;
    const metric = this.metrics.get(name);

    if (metric) {
      if (!metric.labeledValues) {
        metric.labeledValues = new Map();
      }
      metric.labeledValues.set(this.formatLabels(labels), value);
    }
  }

  private updateHistogram(name: string, values: HistogramValues): void {
    const metric = this.metrics.get(name);
    if (metric) {
      metric.histogramValues = values;
    }
  }

  private formatLabels(labels: Record<string, string>): string {
    const allLabels = { ...this.config.labels, ...labels };
    if (Object.keys(allLabels).length === 0) return '';

    const pairs = Object.entries(allLabels)
      .map(([key, value]) => `${key}="${value}"`)
      .join(',');

    return `{${pairs}}`;
  }

  /**
   * Get metrics in Prometheus exposition format
   */
  getMetrics(): string {
    const lines: string[] = [];

    for (const metric of this.metrics.values()) {
      // Add help and type comments
      lines.push(`# HELP ${metric.name} ${metric.help}`);
      lines.push(`# TYPE ${metric.name} ${metric.type}`);

      if (metric.type === 'histogram' && metric.histogramValues) {
        // Format histogram metrics
        const baseLabels = this.formatLabels({});
        lines.push(`${metric.name}_sum${baseLabels} ${metric.histogramValues.avg}`);
        lines.push(`${metric.name}_count${baseLabels} 1`);
        lines.push(`${metric.name}_bucket{le="0.5"} ${metric.histogramValues.p50}`);
        lines.push(`${metric.name}_bucket{le="0.95"} ${metric.histogramValues.p95}`);
        lines.push(`${metric.name}_bucket{le="0.99"} ${metric.histogramValues.p99}`);
        lines.push(`${metric.name}_bucket{le="+Inf"} 1`);
      } else if (metric.labeledValues && metric.labeledValues.size > 0) {
        // Format metrics with labels
        for (const [labels, value] of metric.labeledValues.entries()) {
          lines.push(`${metric.name}${labels} ${value}`);
        }
      } else {
        // Format simple metrics
        const labels = this.formatLabels({});
        lines.push(`${metric.name}${labels} ${metric.value}`);
      }

      lines.push(''); // Empty line between metrics
    }

    return lines.join('\n');
  }

  /**
   * Reset all metrics to initial values
   */
  reset(): void {
    for (const metric of this.metrics.values()) {
      metric.value = 0;
      if (metric.labeledValues) {
        metric.labeledValues.clear();
      }
      if (metric.histogramValues) {
        metric.histogramValues = {
          avg: 0,
          p50: 0,
          p95: 0,
          p99: 0
        };
      }
    }
  }
}

type MetricType = 'counter' | 'gauge' | 'histogram';

interface PrometheusMetric {
  name: string;
  type: MetricType;
  help: string;
  value: number;
  labels: Record<string, string>;
  labeledValues?: Map<string, number>;
  histogramValues?: HistogramValues;
}

interface HistogramValues {
  avg: number;
  p50: number;
  p95: number;
  p99: number;
}

export interface PrometheusConfig {
  prefix?: string;
  labels?: Record<string, string>;
}