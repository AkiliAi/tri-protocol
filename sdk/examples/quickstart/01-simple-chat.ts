/**
 * Simple Chat Example
 * This example demonstrates the simplest way to use the Tri-Protocol SDK
 */

import { TriProtocolSDK } from '@tri-protocol/sdk';

async function main() {
  // Initialize SDK with minimal configuration
  const sdk = await TriProtocolSDK.initialize({
    mode: 'development',
    llm: {
      provider: 'ollama',
      model: 'llama2'
    }
  });

  // Simple chat interaction
  const response = await sdk.chat('Hello! How are you today?');
  console.log('Response:', response);

  // Continue the conversation
  const followUp = await sdk.chat('What can you help me with?');
  console.log('Follow-up:', followUp);

  // Ask a question
  const answer = await sdk.query('What is the capital of France?');
  console.log('Answer:', answer);

  // Clean shutdown
  await sdk.shutdown();
}

// Run the example
main().catch(console.error);