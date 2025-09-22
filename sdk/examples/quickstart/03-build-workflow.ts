/**
 * Build Workflow Example
 * This example demonstrates how to create and execute workflows
 */

import { TriProtocolSDK } from '@tri-protocol/sdk';

async function main() {
  const sdk = await TriProtocolSDK.initialize({
    mode: 'development'
  });

  // Create a simple sequential workflow
  const dataProcessing = await (await sdk.createWorkflow('DataProcessor'))
    .withDescription('Process and analyze CSV data')
    .withTimeout(60000)
    .withRetries(2)
    .addStep({
      type: 'tool',
      config: {
        tool: 'file-reader',
        action: 'read',
        args: { path: 'data.csv' }
      }
    })
    .transform((data: any) => {
      // Clean and validate data
      console.log('Transforming data...');
      return {
        ...data,
        cleaned: true,
        timestamp: new Date().toISOString()
      };
    })
    .filter((item: any) => item.value > 0)
    .addStep({
      type: 'agent',
      config: {
        agentId: 'analyst',
        action: 'analyze'
      }
    })
    .build();

  // Execute the workflow
  const result = await dataProcessing.execute({
    input: 'data.csv'
  });
  console.log('Workflow Result:', result);

  // Create a parallel processing workflow
  const parallelWorkflow = await (await sdk.createWorkflow('ParallelProcessor'))
    .withDescription('Process multiple data sources in parallel')
    .parallel(
      {
        type: 'tool',
        config: { tool: 'api-fetcher', endpoint: '/data1' }
      },
      {
        type: 'tool',
        config: { tool: 'api-fetcher', endpoint: '/data2' }
      },
      {
        type: 'tool',
        config: { tool: 'database-query', query: 'SELECT * FROM metrics' }
      }
    )
    .addStep({
      type: 'task',
      config: {
        name: 'merge-results',
        action: 'merge'
      }
    })
    .build();

  // Create a conditional workflow
  const conditionalWorkflow = await (await sdk.createWorkflow('ConditionalProcessor'))
    .withDescription('Process based on conditions')
    .addStep({
      type: 'task',
      config: {
        name: 'analyze-input',
        action: 'analyze'
      }
    })
    .condition('input.type === "research"')
      .then((builder) => {
        builder
          .useAgent('researcher', 'research')
          .useTool('web-search', { query: 'latest findings' });
      })
      .else((builder) => {
        builder
          .useAgent('assistant', 'process')
          .addStep({ type: 'task', config: { name: 'format-output' } });
      })
    .addStep({
      type: 'task',
      config: {
        name: 'final-formatting',
        action: 'format'
      }
    })
    .build();

  // Create a loop workflow
  const loopWorkflow = await (await sdk.createWorkflow('IterativeProcessor'))
    .withDescription('Process items iteratively')
    .loop('items.length > 0', (builder) => {
      builder
        .addStep({
          type: 'task',
          config: {
            name: 'process-item',
            action: 'process'
          }
        })
        .transform((item: any) => ({
          ...item,
          processed: true
        }))
        .addStep({
          type: 'task',
          config: {
            name: 'update-items',
            action: 'shift'
          }
        });
    })
    .addStep({
      type: 'task',
      config: {
        name: 'summarize',
        action: 'summarize'
      }
    })
    .build();

  await sdk.shutdown();
}

main().catch(console.error);