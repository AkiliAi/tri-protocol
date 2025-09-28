import { MetricExporter, MetricSnapshot } from '../SDKMetrics';
import { LoggerManager } from '@tri-protocol/logger';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * File exporter for SDK metrics
 * Writes metrics to a file in JSONL format
 */
export class FileExporter implements MetricExporter {
  name = 'file';
  private filePath: string;
  private config: FileExporterConfig;
  private logger = LoggerManager.getLogger('FileExporter');

  constructor(filePath: string, config: FileExporterConfig = {}) {
    this.filePath = filePath;
    this.config = {
      format: config.format || 'jsonl',
      rotateSize: config.rotateSize || 10 * 1024 * 1024, // 10MB default
      rotateCount: config.rotateCount || 5,
      ...config
    };
  }

  async export(metrics: MetricSnapshot): Promise<void> {
    try {
      await this.ensureDirectory();

      if (this.config.format === 'csv') {
        await this.exportCSV(metrics);
      } else {
        await this.exportJSONL(metrics);
      }

      // Check if rotation is needed
      if (this.config.rotateSize) {
        await this.checkRotation();
      }
    } catch (error) {
      this.logger.error(`Failed to export metrics to file: ${error}`);
      throw error;
    }
  }

  private async ensureDirectory(): Promise<void> {
    const dir = path.dirname(this.filePath);
    try {
      await fs.access(dir);
    } catch {
      await fs.mkdir(dir, { recursive: true });
    }
  }

  private async exportJSONL(metrics: MetricSnapshot): Promise<void> {
    const line = JSON.stringify({
      ...metrics,
      timestamp: metrics.timestamp.toISOString()
    }) + '\n';

    await fs.appendFile(this.filePath, line);
  }

  private async exportCSV(metrics: MetricSnapshot): Promise<void> {
    const fileExists = await this.fileExists(this.filePath);

    // Flatten metrics for CSV format
    const flatMetrics = this.flattenMetrics(metrics);

    if (!fileExists) {
      // Write header
      const header = Object.keys(flatMetrics).join(',') + '\n';
      await fs.writeFile(this.filePath, header);
    }

    // Write data row
    const row = Object.values(flatMetrics).join(',') + '\n';
    await fs.appendFile(this.filePath, row);
  }

  private flattenMetrics(metrics: MetricSnapshot): Record<string, string | number> {
    return {
      timestamp: metrics.timestamp.toISOString(),
      totalAgentsCreated: metrics.totalAgentsCreated,
      activeAgents: metrics.activeAgents,
      totalWorkflowsExecuted: metrics.totalWorkflowsExecuted,
      activeWorkflows: metrics.activeWorkflows,
      totalQueries: metrics.totalQueries,
      averageResponseTime: Math.round(metrics.averageResponseTime),
      p50ResponseTime: Math.round(metrics.p50ResponseTime),
      p95ResponseTime: Math.round(metrics.p95ResponseTime),
      p99ResponseTime: Math.round(metrics.p99ResponseTime),
      totalErrors: metrics.totalErrors,
      errorRate: metrics.errorRate,
      memoryHeapUsed: metrics.memoryUsage.heapUsed,
      memoryHeapTotal: metrics.memoryUsage.heapTotal,
      memoryRss: metrics.memoryUsage.rss,
      protocolA2A: metrics.protocolUsage.a2a,
      protocolMCP: metrics.protocolUsage.mcp,
      protocolLangGraph: metrics.protocolUsage.langgraph,
      llmTotal: metrics.llmCalls.total,
      llmCacheHits: metrics.llmCalls.cacheHits,
      llmCacheHitRate: metrics.llmCalls.cacheHitRate,
      llmAverageTokens: Math.round(metrics.llmCalls.averageTokens),
      llmTotalCost: metrics.llmCalls.totalCost || 0,
      builderAgent: metrics.builderUsage.agentBuilder,
      builderWorkflow: metrics.builderUsage.workflowBuilder,
      builderFromTemplate: metrics.builderUsage.fromTemplate,
      builderFromScratch: metrics.builderUsage.fromScratch
    };
  }

  private async fileExists(path: string): Promise<boolean> {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }

  private async checkRotation(): Promise<void> {
    try {
      const stats = await fs.stat(this.filePath);

      if (stats.size >= this.config.rotateSize!) {
        await this.rotateFiles();
      }
    } catch (error) {
      // File doesn't exist yet, no rotation needed
    }
  }

  private async rotateFiles(): Promise<void> {
    const maxRotations = this.config.rotateCount || 5;

    // Delete oldest rotation if it exists
    const oldestFile = `${this.filePath}.${maxRotations}`;
    if (await this.fileExists(oldestFile)) {
      await fs.unlink(oldestFile);
    }

    // Rotate existing files
    for (let i = maxRotations - 1; i >= 1; i--) {
      const currentFile = i === 1 ? this.filePath : `${this.filePath}.${i}`;
      const nextFile = `${this.filePath}.${i + 1}`;

      if (await this.fileExists(currentFile)) {
        await fs.rename(currentFile, nextFile);
      }
    }

    // Create new empty file
    await fs.writeFile(this.filePath, '');
  }
}

export interface FileExporterConfig {
  format?: 'jsonl' | 'csv';
  rotateSize?: number; // bytes
  rotateCount?: number;
}