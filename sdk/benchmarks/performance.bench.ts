/**
 * Performance Benchmarks for Tri-Protocol SDK
 * Measures the performance of key SDK operations
 */

import { TriProtocolSDK } from '../../src/TriProtocolSDK';
import { ConsoleExporter } from '../../src/metrics/exporters';
import * as fs from 'fs/promises';
import { LoggerManager } from '@tri-protocol/logger';

interface BenchmarkResult {
  name: string;
  runs: number;
  totalTime: number;
  avgTime: number;
  minTime: number;
  maxTime: number;
  opsPerSecond: number;
  standardDeviation: number;
}

class Benchmark {
  private results: BenchmarkResult[] = [];
  private logger = LoggerManager.getLogger('Benchmark');

  async run(name: string, fn: () => Promise<void>, options: { runs?: number; warmup?: number } = {}): Promise<BenchmarkResult> {
    const runs = options.runs || 100;
    const warmup = options.warmup || 10;

    this.logger.info(`Running benchmark: ${name}`);

    // Warmup phase
    for (let i = 0; i < warmup; i++) {
      await fn();
    }

    // Actual benchmark
    const times: number[] = [];
    const startTotal = process.hrtime.bigint();

    for (let i = 0; i < runs; i++) {
      const start = process.hrtime.bigint();
      await fn();
      const end = process.hrtime.bigint();
      times.push(Number(end - start) / 1_000_000); // Convert to milliseconds
    }

    const endTotal = process.hrtime.bigint();
    const totalTime = Number(endTotal - startTotal) / 1_000_000;

    // Calculate statistics
    const avgTime = totalTime / runs;
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    const opsPerSecond = 1000 / avgTime;

    // Calculate standard deviation
    const variance = times.reduce((sum, time) => sum + Math.pow(time - avgTime, 2), 0) / runs;
    const standardDeviation = Math.sqrt(variance);

    const result: BenchmarkResult = {
      name,
      runs,
      totalTime,
      avgTime,
      minTime,
      maxTime,
      opsPerSecond,
      standardDeviation
    };

    this.results.push(result);
    return result;
  }

  printResults(): void {
    this.logger.info('\n╔══════════════════════════════════════════════════════════════╗');
    this.logger.info('║                    BENCHMARK RESULTS                        ║');
    this.logger.info('╚══════════════════════════════════════════════════════════════╝\n');

    const table = this.results.map(r => ({
      'Operation': r.name,
      'Runs': r.runs,
      'Avg (ms)': r.avgTime.toFixed(3),
      'Min (ms)': r.minTime.toFixed(3),
      'Max (ms)': r.maxTime.toFixed(3),
      'Ops/sec': r.opsPerSecond.toFixed(2),
      'Std Dev': r.standardDeviation.toFixed(3)
    }));

    console.table(table);
  }

  async saveReport(filename: string): Promise<void> {
    const report = {
      date: new Date().toISOString(),
      platform: process.platform,
      nodeVersion: process.version,
      results: this.results
    };

    await fs.writeFile(filename, JSON.stringify(report, null, 2));
    this.logger.info(`Report saved to ${filename}`);
  }
}

async function runBenchmarks() {
  const bench = new Benchmark();
  const logger = LoggerManager.getLogger('BenchmarkRunner');

  logger.info('Initializing SDK for benchmarks...');

  // Setup SDK instances
  const sdks: Map<string, TriProtocolSDK> = new Map();

  // Benchmark 1: SDK Initialization
  await bench.run('SDK Initialization', async () => {
    const id = `bench-${Date.now()}-${Math.random()}`;
    const sdk = await TriProtocolSDK.initialize(id, {
      mode: 'test' as any,
      metrics: { enabled: false } // Disable metrics to measure pure performance
    });
    await sdk.shutdown();
  }, { runs: 50, warmup: 5 });

  // Create a persistent SDK for other benchmarks
  const mainSdk = await TriProtocolSDK.initialize('bench-main', {
    mode: 'test' as any,
    metrics: { enabled: true }
  });

  // Benchmark 2: Agent Creation
  await bench.run('Agent Creation (No Template)', async () => {
    const builder = await mainSdk.createAgent(`Agent-${Date.now()}`);
    await builder.build();
  }, { runs: 100, warmup: 10 });

  // Benchmark 3: Agent Creation with Template
  await bench.run('Agent Creation (With Template)', async () => {
    await mainSdk.createAgent(`TemplateAgent-${Date.now()}`, 'chat');
  }, { runs: 100, warmup: 10 });

  // Benchmark 4: Simple Query
  await bench.run('Simple Query', async () => {
    await mainSdk.query('What is 2+2?');
  }, { runs: 100, warmup: 10 });

  // Benchmark 5: Complex Query
  await bench.run('Complex Query', async () => {
    await mainSdk.query('Analyze the performance characteristics of distributed systems and explain cache coherence protocols');
  }, { runs: 50, warmup: 5 });

  // Benchmark 6: Workflow Creation
  await bench.run('Workflow Creation', async () => {
    const workflow = await mainSdk.createWorkflow(`Workflow-${Date.now()}`)
      .step('step1', { type: 'task' })
      .step('step2', { type: 'task' })
      .step('step3', { type: 'task' })
      .build();
  }, { runs: 100, warmup: 10 });

  // Benchmark 7: Workflow Execution
  const testWorkflow = await mainSdk.createWorkflow('BenchWorkflow')
    .step('input', { type: 'task' })
    .step('process', { type: 'task' })
    .step('output', { type: 'task' })
    .build();

  await bench.run('Workflow Execution', async () => {
    await testWorkflow.execute({ data: 'test' });
  }, { runs: 50, warmup: 5 });

  // Benchmark 8: Metrics Collection
  mainSdk.enableMetricsExport(new ConsoleExporter({ format: 'json' }));

  await bench.run('Metrics Collection', async () => {
    await mainSdk.getMetrics().collect();
  }, { runs: 100, warmup: 10 });

  // Benchmark 9: Metrics Snapshot
  await bench.run('Metrics Snapshot', async () => {
    mainSdk.getMetricsSnapshot();
  }, { runs: 1000, warmup: 100 });

  // Benchmark 10: Multi-Agent Communication
  const agent1 = await (await mainSdk.createAgent('BenchAgent1')).build();
  const agent2 = await (await mainSdk.createAgent('BenchAgent2')).build();

  await bench.run('Agent Communication', async () => {
    await agent1.communicate(agent2.id, { message: 'benchmark' });
  }, { runs: 100, warmup: 10 });

  // Benchmark 11: Error Handling
  await bench.run('Error Handling', async () => {
    try {
      await mainSdk.runWorkflow('NonExistentWorkflow', {});
    } catch {
      // Expected error
    }
  }, { runs: 100, warmup: 10 });

  // Benchmark 12: Plugin Registration
  const mockPlugin = {
    name: `plugin-${Date.now()}`,
    install: async () => { /* noop */ }
  };

  await bench.run('Plugin Registration', async () => {
    await mainSdk.registerPlugin({ ...mockPlugin, name: `plugin-${Date.now()}` });
  }, { runs: 50, warmup: 5 });

  // Memory benchmark
  logger.info('\nRunning memory benchmark...');
  const memoryBefore = process.memoryUsage();

  // Create many agents to test memory usage
  for (let i = 0; i < 100; i++) {
    await (await mainSdk.createAgent(`MemAgent${i}`)).build();
  }

  const memoryAfter = process.memoryUsage();
  const memoryDelta = {
    heapUsed: (memoryAfter.heapUsed - memoryBefore.heapUsed) / 1024 / 1024,
    heapTotal: (memoryAfter.heapTotal - memoryBefore.heapTotal) / 1024 / 1024,
    rss: (memoryAfter.rss - memoryBefore.rss) / 1024 / 1024
  };

  logger.info('\n📊 Memory Usage (100 agents):');
  logger.info(`  Heap Used Delta: ${memoryDelta.heapUsed.toFixed(2)} MB`);
  logger.info(`  Heap Total Delta: ${memoryDelta.heapTotal.toFixed(2)} MB`);
  logger.info(`  RSS Delta: ${memoryDelta.rss.toFixed(2)} MB`);
  logger.info(`  Avg per Agent: ${(memoryDelta.heapUsed / 100).toFixed(3)} MB\n`);

  // Cleanup
  await mainSdk.shutdown();

  // Print results
  bench.printResults();

  // Save report
  await bench.saveReport(`benchmark-report-${Date.now()}.json`);

  // Generate performance insights
  logger.info('\n🎯 Performance Insights:');

  const queryBenchmark = bench['results'].find(r => r.name === 'Simple Query');
  if (queryBenchmark && queryBenchmark.opsPerSecond > 100) {
    logger.info('✅ Query performance is excellent (>100 ops/sec)');
  } else if (queryBenchmark && queryBenchmark.opsPerSecond > 50) {
    logger.info('⚠️ Query performance is good but could be improved (50-100 ops/sec)');
  } else {
    logger.info('❌ Query performance needs optimization (<50 ops/sec)');
  }

  const agentCreation = bench['results'].find(r => r.name === 'Agent Creation (No Template)');
  if (agentCreation && agentCreation.avgTime < 10) {
    logger.info('✅ Agent creation is fast (<10ms)');
  } else if (agentCreation && agentCreation.avgTime < 50) {
    logger.info('⚠️ Agent creation is moderate (10-50ms)');
  } else {
    logger.info('❌ Agent creation is slow (>50ms)');
  }
}

// Run benchmarks if this file is executed directly
if (require.main === module) {
  runBenchmarks().catch(error => {
    console.error('Benchmark failed:', error);
    process.exit(1);
  });
}