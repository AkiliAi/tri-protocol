import { MetricExporter, MetricSnapshot } from '../SDKMetrics';
import { LoggerManager } from '@tri-protocol/logger';

/**
 * Console exporter for SDK metrics
 * Outputs metrics to console in a formatted manner
 */
export class ConsoleExporter implements MetricExporter {
  name = 'console';
  private config: ConsoleExporterConfig;
  private logger = LoggerManager.getLogger('ConsoleExporter');

  constructor(config: ConsoleExporterConfig = {}) {
    this.config = {
      format: config.format || 'compact',
      colors: config.colors !== false,
      ...config
    };
  }

  async export(metrics: MetricSnapshot): Promise<void> {
    if (this.config.format === 'detailed') {
      this.exportDetailed(metrics);
    } else if (this.config.format === 'json') {
      this.exportJSON(metrics);
    } else {
      this.exportCompact(metrics);
    }
  }

  private exportCompact(metrics: MetricSnapshot): void {
    const output = [
      '=== SDK Metrics ===',
      `Timestamp: ${metrics.timestamp.toISOString()}`,
      `Active Agents: ${metrics.activeAgents}/${metrics.totalAgentsCreated}`,
      `Active Workflows: ${metrics.activeWorkflows}/${metrics.totalWorkflowsExecuted}`,
      `Total Queries: ${metrics.totalQueries}`,
      `Avg Response Time: ${Math.round(metrics.averageResponseTime)}ms (P95: ${Math.round(metrics.p95ResponseTime)}ms)`,
      `Error Rate: ${metrics.errorRate}/min (Total: ${metrics.totalErrors})`,
      `Memory Usage: ${this.formatBytes(metrics.memoryUsage.heapUsed)}/${this.formatBytes(metrics.memoryUsage.heapTotal)}`,
      `LLM Calls: ${metrics.llmCalls.total} (Cache Hit: ${metrics.llmCalls.cacheHitRate.toFixed(1)}%)`
    ];

    if (metrics.llmCalls.totalCost !== undefined) {
      output.push(`LLM Cost: $${metrics.llmCalls.totalCost.toFixed(4)}`);
    }

    output.push('==================');

    this.logger.info(this.config.colors ? this.colorize(output) : output.join('\n'));
  }

  private exportDetailed(metrics: MetricSnapshot): void {
    this.logger.info('\n╔══════════════════════════════════════════════╗');
    this.logger.info('║         SDK Metrics Report                  ║');
    this.logger.info('╚══════════════════════════════════════════════╝\n');

    this.logger.info(`📅 Timestamp: ${metrics.timestamp.toISOString()}\n`);

    this.logger.info('📊 Usage Metrics:');
    this.logger.info(`  • Agents Created: ${metrics.totalAgentsCreated}`);
    this.logger.info(`  • Active Agents: ${metrics.activeAgents}`);
    this.logger.info(`  • Workflows Executed: ${metrics.totalWorkflowsExecuted}`);
    this.logger.info(`  • Active Workflows: ${metrics.activeWorkflows}`);
    this.logger.info(`  • Total Queries: ${metrics.totalQueries}\n`);

    this.logger.info('⚡ Performance Metrics:');
    this.logger.info(`  • Average Response: ${Math.round(metrics.averageResponseTime)}ms`);
    this.logger.info(`  • P50 Response: ${Math.round(metrics.p50ResponseTime)}ms`);
    this.logger.info(`  • P95 Response: ${Math.round(metrics.p95ResponseTime)}ms`);
    this.logger.info(`  • P99 Response: ${Math.round(metrics.p99ResponseTime)}ms\n`);

    this.logger.info('❌ Error Metrics:');
    this.logger.info(`  • Total Errors: ${metrics.totalErrors}`);
    this.logger.info(`  • Error Rate: ${metrics.errorRate}/min`);
    if (Object.keys(metrics.errorsByType).length > 0) {
      this.logger.info('  • Errors by Type:');
      for (const [type, count] of Object.entries(metrics.errorsByType)) {
        this.logger.info(`    - ${type}: ${count}`);
      }
    }
    this.logger.info('');

    this.logger.info('💾 Memory Usage:');
    this.logger.info(`  • Heap Used: ${this.formatBytes(metrics.memoryUsage.heapUsed)}`);
    this.logger.info(`  • Heap Total: ${this.formatBytes(metrics.memoryUsage.heapTotal)}`);
    this.logger.info(`  • RSS: ${this.formatBytes(metrics.memoryUsage.rss)}\n`);

    this.logger.info('🔌 Protocol Usage:');
    this.logger.info(`  • A2A: ${metrics.protocolUsage.a2a}`);
    this.logger.info(`  • MCP: ${metrics.protocolUsage.mcp}`);
    this.logger.info(`  • LangGraph: ${metrics.protocolUsage.langgraph}\n`);

    this.logger.info('🤖 LLM Metrics:');
    this.logger.info(`  • Total Calls: ${metrics.llmCalls.total}`);
    this.logger.info(`  • Cache Hits: ${metrics.llmCalls.cacheHits} (${metrics.llmCalls.cacheHitRate.toFixed(1)}%)`);
    this.logger.info(`  • Avg Tokens: ${Math.round(metrics.llmCalls.averageTokens)}`);
    if (metrics.llmCalls.totalCost !== undefined) {
      this.logger.info(`  • Total Cost: $${metrics.llmCalls.totalCost.toFixed(4)}`);
    }
    if (Object.keys(metrics.llmCalls.byProvider).length > 0) {
      this.logger.info('  • By Provider:');
      for (const [provider, count] of Object.entries(metrics.llmCalls.byProvider)) {
        this.logger.info(`    - ${provider}: ${count}`);
      }
    }
    this.logger.info('');

    this.logger.info('🔨 Builder Usage:');
    this.logger.info(`  • Agent Builder: ${metrics.builderUsage.agentBuilder}`);
    this.logger.info(`  • Workflow Builder: ${metrics.builderUsage.workflowBuilder}`);
    this.logger.info(`  • From Template: ${metrics.builderUsage.fromTemplate}`);
    this.logger.info(`  • From Scratch: ${metrics.builderUsage.fromScratch}\n`);

    this.logger.info('══════════════════════════════════════════════\n');
  }

  private exportJSON(metrics: MetricSnapshot): void {
    this.logger.info(JSON.stringify({
      ...metrics,
      timestamp: metrics.timestamp.toISOString()
    }, null, 2));
  }

  private formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unitIndex = 0;

    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex++;
    }

    return `${value.toFixed(1)} ${units[unitIndex]}`;
  }

  private colorize(lines: string[]): string {
    // Simple ANSI color codes for console output
    const colors = {
      header: '\x1b[36m', // Cyan
      success: '\x1b[32m', // Green
      warning: '\x1b[33m', // Yellow
      error: '\x1b[31m', // Red
      reset: '\x1b[0m'
    };

    return lines.map(line => {
      if (line.includes('===')) return `${colors.header}${line}${colors.reset}`;
      if (line.includes('Error')) return `${colors.error}${line}${colors.reset}`;
      if (line.includes('Active')) return `${colors.success}${line}${colors.reset}`;
      return line;
    }).join('\n');
  }
}

export interface ConsoleExporterConfig {
  format?: 'compact' | 'detailed' | 'json';
  colors?: boolean;
}