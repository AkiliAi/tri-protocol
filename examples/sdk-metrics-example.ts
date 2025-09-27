/**
 * Example: Using Tri-Protocol SDK with Metrics and Monitoring
 * This example demonstrates how to use the SDK with metrics collection,
 * exporters, and the real-time monitoring dashboard.
 */

import { TriProtocolSDK } from '../sdk/src/TriProtocolSDK';
import {
  ConsoleExporter,
  FileExporter,
  PrometheusExporter
} from '../sdk/src/metrics/exporters';
import { MetricsDashboard } from '../sdk/src/monitoring';
import { LoggerManager } from '../logger/src';

async function main() {
  const logger = LoggerManager.getLogger('SDKMetricsExample');

  logger.info('🚀 Starting Tri-Protocol SDK with Metrics Example');

  // 1. Initialize SDK with metrics configuration
  const sdk = await TriProtocolSDK.initialize('example-instance', {
    mode: 'development',

    // Configure metrics
    metrics: {
      enabled: true,
      collectInterval: 5000, // Collect metrics every 5 seconds
      exporters: [
        // Console exporter with detailed format
        new ConsoleExporter({
          format: 'detailed',
          colors: true
        }),

        // File exporter for persistent metrics
        new FileExporter('./metrics/sdk-metrics.jsonl', {
          format: 'jsonl',
          rotateSize: 10 * 1024 * 1024, // 10MB
          rotateCount: 5
        }),

        // Prometheus exporter for monitoring systems
        new PrometheusExporter({
          prefix: 'tri_sdk',
          labels: {
            environment: 'development',
            instance: 'example'
          }
        })
      ]
    },

    // Enable all protocols
    protocols: {
      a2a: true,
      mcp: true,
      langgraph: true
    },

    // Configure LLM
    llm: {
      provider: 'ollama',
      model: 'llama2',
      temperature: 0.7
    },

    // Configure logging
    logging: {
      level: 'info',
      enabled: true
    }
  });

  logger.info('✅ SDK initialized with metrics');

  // 2. Start the monitoring dashboard
  const dashboard = new MetricsDashboard(sdk, 3001);
  await dashboard.start();

  logger.info('📊 Dashboard available at http://localhost:3001');

  // 3. Create some agents to generate metrics
  logger.info('Creating agents...');

  // Create agent from scratch
  const customAgent = await (await sdk.createAgent('CustomAnalyst'))
    .withCapability('analysis')
    .withCapability('reporting')
    .withMemory('both')
    .build();

  // Create agent from template
  // When using a template, createAgent returns the agent directly if the template exists,
  // otherwise it returns a builder
  const chatAgentOrBuilder = await sdk.createAgent('ChatBot', 'chat');
  const chatAgent = chatAgentOrBuilder.build ? await chatAgentOrBuilder.build() : chatAgentOrBuilder;

  logger.info('✅ Agents created');

  // 4. Execute some queries to generate performance metrics
  logger.info('Executing queries...');

  const queries = [
    'What is artificial intelligence?',
    'Explain quantum computing',
    'How does blockchain work?',
    'What are microservices?',
    'Describe machine learning'
  ];

  for (const query of queries) {
    try {
      const result = await sdk.query(query);
      logger.info(`Query: "${query}" - Response length: ${result.length} chars`);
    } catch (error) {
      logger.error(`Query failed: ${error}`);
    }
  }

  // 5. Create and execute workflows
  logger.info('Creating and executing workflows...');

  const workflowBuilder = await sdk.createWorkflow('DataProcessing');
  const workflow = await workflowBuilder
    .step('input', {
      type: 'task',
      handler: async (data: any) => {
        logger.info('Input step executing...');
        return { ...data, inputProcessed: true };
      }
    })
    .step('transform', {
      type: 'task',
      handler: async (data: any) => {
        logger.info('Transform step executing...');
        return { ...data, transformed: true };
      }
    })
    .step('output', {
      type: 'task',
      handler: async (data: any) => {
        logger.info('Output step executing...');
        return { ...data, complete: true };
      }
    })
    .build();

  const workflowResult = await workflow.execute({
    data: 'test data',
    timestamp: Date.now()
  });

  logger.info('✅ Workflow executed:', workflowResult);

  // 6. Simulate some errors to track error metrics
  logger.info('Simulating errors for metrics...');

  for (let i = 0; i < 3; i++) {
    try {
      await sdk.runWorkflow('NonExistentWorkflow', {});
    } catch (error) {
      // Expected error - will be tracked in metrics
    }
  }

  // 7. Simulate protocol usage
  logger.info('Simulating protocol usage...');

  // Trigger protocol usage events
  sdk.emit('protocol:a2a:used');
  sdk.emit('protocol:mcp:used');
  sdk.emit('protocol:langgraph:used');

  // Simulate LLM calls
  for (let i = 0; i < 5; i++) {
    sdk.emit('llm:call', {
      provider: 'ollama',
      tokens: Math.floor(Math.random() * 500) + 100,
      cached: Math.random() > 0.5,
      cost: Math.random() * 0.01
    });
  }

  // 8. Access metrics programmatically
  logger.info('\n📈 Current Metrics Snapshot:');

  const metrics = sdk.getMetricsSnapshot();

  logger.info(`  Total Queries: ${metrics.totalQueries}`);
  logger.info(`  Active Agents: ${metrics.activeAgents}`);
  logger.info(`  Total Agents Created: ${metrics.totalAgentsCreated}`);
  logger.info(`  Active Workflows: ${metrics.activeWorkflows}`);
  logger.info(`  Total Workflows Executed: ${metrics.totalWorkflowsExecuted}`);
  logger.info(`  Average Response Time: ${metrics.averageResponseTime.toFixed(2)}ms`);
  logger.info(`  P95 Response Time: ${metrics.p95ResponseTime.toFixed(2)}ms`);
  logger.info(`  Total Errors: ${metrics.totalErrors}`);
  logger.info(`  Error Rate: ${metrics.errorRate}/min`);
  logger.info(`  Memory Usage: ${(metrics.memoryUsage.heapUsed / 1024 / 1024).toFixed(2)}MB`);

  if (metrics.llmCalls.total > 0) {
    logger.info(`  LLM Calls: ${metrics.llmCalls.total}`);
    logger.info(`  LLM Cache Hit Rate: ${metrics.llmCalls.cacheHitRate.toFixed(1)}%`);
    logger.info(`  LLM Total Cost: $${metrics.llmCalls.totalCost?.toFixed(4) || '0.0000'}`);
  }

  // 9. Demonstrate metric collection over time
  logger.info('\n⏱️ Collecting metrics over time...');

  const collectionInterval = setInterval(() => {
    const currentMetrics = sdk.getMetricsSnapshot();
    logger.info(`[${new Date().toLocaleTimeString()}] Queries: ${currentMetrics.totalQueries}, Errors: ${currentMetrics.totalErrors}, Memory: ${(currentMetrics.memoryUsage.heapUsed / 1024 / 1024).toFixed(2)}MB`);
  }, 5000);

  // 10. Generate continuous load for dashboard visualization
  logger.info('\n🔄 Generating continuous load for dashboard visualization...');
  logger.info('   Open http://localhost:3001 to see real-time metrics');

  const loadInterval = setInterval(async () => {
    // Random query
    const randomQuery = queries[Math.floor(Math.random() * queries.length)];
    sdk.query(randomQuery).catch(() => {}); // Ignore errors

    // Random protocol usage
    const protocols = ['a2a', 'mcp', 'langgraph'];
    const randomProtocol = protocols[Math.floor(Math.random() * protocols.length)];
    sdk.emit(`protocol:${randomProtocol}:used`);

    // Random LLM call
    if (Math.random() > 0.5) {
      sdk.emit('llm:call', {
        provider: ['ollama', 'openai', 'anthropic'][Math.floor(Math.random() * 3)],
        tokens: Math.floor(Math.random() * 1000) + 50,
        cached: Math.random() > 0.6,
        cost: Math.random() * 0.02
      });
    }

    // Occasional error
    if (Math.random() > 0.9) {
      sdk.getMetrics().recordError(new Error('Simulated error'), {
        type: 'simulation',
        timestamp: Date.now()
      });
    }
  }, 2000);

  // Keep the example running
  logger.info('\n✨ Example is running. Press Ctrl+C to stop.');
  logger.info('   Dashboard: http://localhost:3001');
  logger.info('   Prometheus: http://localhost:3001/metrics');
  logger.info('   Health: http://localhost:3001/health');

  // Graceful shutdown handler
  process.on('SIGINT', async () => {
    logger.info('\n\n🛑 Shutting down...');

    clearInterval(collectionInterval);
    clearInterval(loadInterval);

    // Get final metrics
    const finalMetrics = sdk.getMetricsSnapshot();
    logger.info('\n📊 Final Metrics Summary:');
    logger.info(`  Total Queries Processed: ${finalMetrics.totalQueries}`);
    logger.info(`  Total Agents Created: ${finalMetrics.totalAgentsCreated}`);
    logger.info(`  Total Workflows Executed: ${finalMetrics.totalWorkflowsExecuted}`);
    logger.info(`  Total Errors: ${finalMetrics.totalErrors}`);
    logger.info(`  Average Response Time: ${finalMetrics.averageResponseTime.toFixed(2)}ms`);

    // Stop dashboard
    await dashboard.stop();

    // Shutdown SDK
    await sdk.shutdown();

    logger.info('✅ Shutdown complete');
    process.exit(0);
  });
}

// Run the example
main().catch(error => {
  console.error('Example failed:', error);
  process.exit(1);
});