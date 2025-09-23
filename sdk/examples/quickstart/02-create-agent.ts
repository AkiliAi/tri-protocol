/**
 * Create Custom Agent Example
 * This example shows how to create and configure a custom agent
 */

// @ts-ignore
import { TriProtocolSDK } from '@tri-protocol/sdk';

async function main() {
  // Initialize SDK
  const sdk = await TriProtocolSDK.initialize({
    mode: 'development',
    persistence: {
      enabled: true,
      backend: 'memory'
    }
  });

  // Create a custom research agent using the builder pattern
  const researcher = await (await sdk.createAgent('ResearchBot'))
    .withDescription('An expert researcher for technical topics')
    .withPersonality(`
      You are a meticulous researcher specializing in technology and science.
      You provide well-sourced, accurate information with citations.
      You clearly distinguish between facts and speculation.
    `)
    .withCapability('research')
    .withCapability('fact-checking')
    .withCapability('summarization')
    .withTool('web-search')
    .withTool('document-reader')
    .withMemory('long')
    .withLLM({
      temperature: 0.3,  // Lower temperature for factual accuracy
      maxTokens: 4096
    })
    .canCommunicate()
    .canUseTools()
    .build();

  // Use the researcher
  const research = await researcher.respond(
    'What are the latest developments in quantum computing?'
  );
  console.log('Research Results:', research);

  // Create a simple assistant from template
  const assistant = await (await sdk.createAgent('Helper', 'assistant')).build();

  // Use the assistant
  const help = await assistant.respond('Help me plan a project timeline');
  console.log('Assistant Response:', help);

  // Create an analyst from template
  const analyst = await (await sdk.createAgent('DataAnalyst', 'analyst')).build();

  // Analyze some data
  const analysis = await analyst.execute({
    action: 'analyze',
    data: {
      sales: [100, 150, 120, 180, 200],
      months: ['Jan', 'Feb', 'Mar', 'Apr', 'May']
    },
    type: 'trend-analysis'
  });
  console.log('Analysis:', analysis);

  await sdk.shutdown();
}

main().catch(console.error);