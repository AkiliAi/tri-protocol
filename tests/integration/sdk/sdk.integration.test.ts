/**
 * SDK Integration Tests
 * Tests the complete SDK functionality with metrics collection
 */

import { TriProtocolSDK } from '../../../sdk/src/TriProtocolSDK';
import { ConsoleExporter, FileExporter, PrometheusExporter } from '../../../sdk/src/metrics/exporters';
import * as fs from 'fs/promises';
import * as path from 'path';

describe('SDK Integration Tests', () => {
  let sdk: TriProtocolSDK;
  const metricsFile = path.join(__dirname, 'test-metrics.jsonl');

  beforeAll(async () => {
    // Clean up any existing metrics file
    try {
      await fs.unlink(metricsFile);
    } catch {
      // File doesn't exist, ignore
    }

    // Initialize SDK with metrics enabled
    sdk = await TriProtocolSDK.initialize('integration-test', {
      mode: 'test' as any,
      metrics: {
        enabled: true,
        collectInterval: 1000, // Collect every second for testing
        exporters: [
          new ConsoleExporter({ format: 'compact' }),
          new FileExporter(metricsFile, { format: 'jsonl' })
        ]
      },
      protocols: {
        a2a: true,
        mcp: true,
        langgraph: true
      },
      llm: {
        provider: 'ollama',
        model: 'llama2'
      }
    });
  });

  afterAll(async () => {
    if (sdk) {
      await sdk.shutdown();
    }
    // Clean up metrics file
    try {
      await fs.unlink(metricsFile);
    } catch {
      // Ignore errors
    }
  });

  describe('End-to-End Agent Flow', () => {
    it('should create agent, execute task, and track metrics', async () => {
      // Create agent
      const builder = await sdk.createAgent('TestAgent');
      const agent = await builder
        .withCapability('analysis')
        .withMemory('short')
        .build();

      // Execute task
      const result = await agent.respond('Analyze this text');

      // Verify result
      expect(result).toBeDefined();

      // Verify metrics
      const metrics = sdk.getMetricsSnapshot();
      expect(metrics.totalAgentsCreated).toBeGreaterThan(0);
      expect(metrics.activeAgents).toBeGreaterThan(0);
      expect(metrics.builderUsage.agentBuilder).toBeGreaterThan(0);
    });

    it('should track agent creation from template', async () => {
      const initialMetrics = sdk.getMetricsSnapshot();

      // Create agent from template
      const agent = await sdk.createAgent('TemplateAgent', 'chat');

      // Verify metrics
      const metrics = sdk.getMetricsSnapshot();
      expect(metrics.totalAgentsCreated).toBeGreaterThan(initialMetrics.totalAgentsCreated);
      expect(metrics.builderUsage.fromTemplate).toBeGreaterThan(initialMetrics.builderUsage.fromTemplate || 0);
    });
  });

  describe('Complete Workflow Execution', () => {
    it('should execute multi-step workflow with metrics', async () => {
      // Create workflow
      const workflow = await sdk.createWorkflow('TestFlow')
        .step('extract', { type: 'tool', tool: 'file-reader' })
        .step('transform', { type: 'agent', agent: 'DataProcessor' })
        .step('load', { type: 'tool', tool: 'database-writer' })
        .build();

      // Execute workflow
      const result = await workflow.execute({ file: 'test.csv' });

      // Verify execution
      expect(result).toBeDefined();
      expect(result.status).toBe('completed');

      // Verify metrics
      const metrics = sdk.getMetricsSnapshot();
      expect(metrics.totalWorkflowsExecuted).toBeGreaterThan(0);
      expect(metrics.builderUsage.workflowBuilder).toBeGreaterThan(0);
    });

    it('should track workflow template execution', async () => {
      const initialMetrics = sdk.getMetricsSnapshot();

      // Run workflow from template
      try {
        await sdk.runWorkflow('DataPipeline', { input: 'test' });
      } catch {
        // Template might not exist, but metrics should still be tracked
      }

      // Verify metrics were updated
      const metrics = sdk.getMetricsSnapshot();
      expect(metrics.totalWorkflowsExecuted).toBeGreaterThan(initialMetrics.totalWorkflowsExecuted);
    });
  });

  describe('Query Processing', () => {
    it('should track query metrics', async () => {
      const initialMetrics = sdk.getMetricsSnapshot();

      // Execute query
      await sdk.query('What is 2+2?');

      // Verify metrics
      const metrics = sdk.getMetricsSnapshot();
      expect(metrics.totalQueries).toBeGreaterThan(initialMetrics.totalQueries);
      expect(metrics.averageResponseTime).toBeGreaterThanOrEqual(0);
    });

    it('should track multiple queries and calculate percentiles', async () => {
      // Execute multiple queries
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(sdk.query(`Calculate ${i} + ${i}`));
      }
      await Promise.all(promises);

      // Get metrics
      const metrics = sdk.getMetricsSnapshot();

      // Verify percentiles are calculated
      expect(metrics.p50ResponseTime).toBeGreaterThanOrEqual(0);
      expect(metrics.p95ResponseTime).toBeGreaterThanOrEqual(metrics.p50ResponseTime);
      expect(metrics.p99ResponseTime).toBeGreaterThanOrEqual(metrics.p95ResponseTime);
    });
  });

  describe('Error Handling and Recovery', () => {
    it('should track errors in metrics', async () => {
      const initialErrors = sdk.getMetricsSnapshot().totalErrors;

      // Trigger error
      await expect(
        sdk.query('', { throwError: true })
      ).rejects.toThrow();

      // Verify error tracking
      const metrics = sdk.getMetricsSnapshot();
      expect(metrics.totalErrors).toBeGreaterThan(initialErrors);
      expect(metrics.errorRate).toBeGreaterThanOrEqual(0);
    });

    it('should track errors by type', async () => {
      // Trigger different types of errors
      try {
        await sdk.runWorkflow('NonExistentWorkflow', {});
      } catch {
        // Expected error
      }

      const metrics = sdk.getMetricsSnapshot();
      expect(Object.keys(metrics.errorsByType).length).toBeGreaterThan(0);
    });
  });

  describe('Multi-Protocol Integration', () => {
    it('should track protocol usage', async () => {
      // Emit protocol usage events
      sdk.emit('protocol:a2a:used');
      sdk.emit('protocol:mcp:used');
      sdk.emit('protocol:langgraph:used');

      // Verify protocol usage metrics
      const metrics = sdk.getMetricsSnapshot();
      expect(metrics.protocolUsage.a2a).toBeGreaterThan(0);
      expect(metrics.protocolUsage.mcp).toBeGreaterThan(0);
      expect(metrics.protocolUsage.langgraph).toBeGreaterThan(0);
    });
  });

  describe('LLM Metrics', () => {
    it('should track LLM calls', async () => {
      const initialMetrics = sdk.getMetricsSnapshot();

      // Simulate LLM call
      sdk.emit('llm:call', {
        provider: 'ollama',
        tokens: 150,
        cached: false,
        cost: 0.0015
      });

      sdk.emit('llm:call', {
        provider: 'openai',
        tokens: 200,
        cached: true
      });

      // Verify LLM metrics
      const metrics = sdk.getMetricsSnapshot();
      expect(metrics.llmCalls.total).toBeGreaterThan(initialMetrics.llmCalls.total);
      expect(metrics.llmCalls.cacheHits).toBeGreaterThan(initialMetrics.llmCalls.cacheHits);
      expect(metrics.llmCalls.byProvider['ollama']).toBeGreaterThan(0);
      expect(metrics.llmCalls.byProvider['openai']).toBeGreaterThan(0);
      expect(metrics.llmCalls.totalCost).toBeGreaterThan(0);
    });
  });

  describe('Metrics Exporters', () => {
    it('should export metrics to file', async () => {
      // Trigger some activity
      await sdk.query('test query');

      // Wait for metrics collection
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Verify file was created
      const fileExists = await fs.access(metricsFile).then(() => true).catch(() => false);
      expect(fileExists).toBe(true);

      // Read and verify content
      const content = await fs.readFile(metricsFile, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      expect(lines.length).toBeGreaterThan(0);

      // Parse and verify a metric line
      const metric = JSON.parse(lines[0]);
      expect(metric).toHaveProperty('timestamp');
      expect(metric).toHaveProperty('totalQueries');
    });

    it('should support Prometheus exporter', () => {
      const prometheus = new PrometheusExporter({ prefix: 'test_sdk' });
      sdk.enableMetricsExport(prometheus);

      // Get Prometheus formatted metrics
      const metricsText = prometheus.getMetrics();

      // Verify Prometheus format
      expect(metricsText).toContain('# HELP');
      expect(metricsText).toContain('# TYPE');
      expect(metricsText).toContain('test_sdk_');
    });
  });

  describe('Memory and Resource Metrics', () => {
    it('should track memory usage', () => {
      const metrics = sdk.getMetricsSnapshot();

      expect(metrics.memoryUsage).toBeDefined();
      expect(metrics.memoryUsage.heapUsed).toBeGreaterThan(0);
      expect(metrics.memoryUsage.heapTotal).toBeGreaterThan(0);
      expect(metrics.memoryUsage.rss).toBeGreaterThan(0);
    });
  });

  describe('Factory Pattern', () => {
    it('should create multiple SDK instances with different names', async () => {
      const sdk1 = TriProtocolSDK.create('instance1', { mode: 'test' as any });
      const sdk2 = TriProtocolSDK.create('instance2', { mode: 'test' as any });

      expect(sdk1).not.toBe(sdk2);

      // Same name and config should return same instance
      const sdk1Again = TriProtocolSDK.create('instance1', { mode: 'test' as any });
      expect(sdk1).toBe(sdk1Again);
    });
  });

  describe('Metrics Collection Control', () => {
    it('should be able to stop and reset metrics', () => {
      const metrics = sdk.getMetrics();

      // Reset metrics
      metrics.reset();
      const snapshot = metrics.getSnapshot();

      expect(snapshot.totalQueries).toBe(0);
      expect(snapshot.totalAgentsCreated).toBe(0);
      expect(snapshot.totalErrors).toBe(0);
    });
  });
});