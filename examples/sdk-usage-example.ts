/**
 * Example: Basic SDK Usage with Agents and Workflows
 * Demonstrates the correct way to create agents and workflows
 */

import { TriProtocolSDK } from '../sdk/src/TriProtocolSDK';
import { LoggerManager } from '../logger/src';

async function main() {
  const logger = LoggerManager.getLogger('SDKExample');

  logger.info('🚀 Starting SDK Usage Example');

  try {
    // 1. Initialize SDK
    const sdk = await TriProtocolSDK.initialize('example', {
      mode: 'development',
      llm: {
        provider: 'ollama',
        model: 'llama2'
      }
    });

    logger.info('✅ SDK initialized');

    // 2. Create an agent using builder pattern (no template)
    logger.info('\n📌 Creating agent with builder pattern...');
    const agentBuilder = await sdk.createAgent('MyCustomAgent');
    const customAgent = await agentBuilder
      .withDescription('A custom analysis agent')
      .withCapability('analysis')
      .withCapability('reporting')
      .withMemory('short')
      .build();

    logger.info(`✅ Custom agent created: ${customAgent.name}`);

    // 3. Create an agent from template (if template exists)
    logger.info('\n📌 Creating agent from template...');
    const chatAgentResult = await sdk.createAgent('ChatBot', 'chat');

    // Check if it's a builder or an agent
    let chatAgent;
    if (chatAgentResult.build) {
      // It's a builder (template not found)
      logger.info('Template not found, using builder...');
      chatAgent = await chatAgentResult.build();
    } else {
      // It's already an agent (template was found)
      logger.info('Template found, agent created directly');
      chatAgent = chatAgentResult;
    }

    logger.info(`✅ Chat agent created: ${chatAgent.name || 'ChatBot'}`);

    // 4. Use agents
    logger.info('\n📌 Using agents...');

    // Custom agent responds
    try {
      const response1 = await customAgent.respond('Analyze this data: [1,2,3,4,5]');
      logger.info('Custom agent response:', response1);
    } catch (error) {
      logger.error('Custom agent error:', error);
    }

    // Chat agent responds
    try {
      const response2 = await chatAgent.respond('Hello, how are you?');
      logger.info('Chat agent response:', response2);
    } catch (error) {
      logger.error('Chat agent error:', error);
    }

    // 5. Create and use a workflow
    logger.info('\n📌 Creating workflow...');
    const workflowBuilder = await sdk.createWorkflow('DataPipeline');
    const workflow = await workflowBuilder
      .step('input', {
        type: 'task',
        handler: async (data: any) => {
          logger.info('Step 1: Input processing');
          return { ...data, step1: true };
        }
      })
      .step('process', {
        type: 'task',
        handler: async (data: any) => {
          logger.info('Step 2: Data processing');
          return { ...data, step2: true };
        }
      })
      .step('output', {
        type: 'task',
        handler: async (data: any) => {
          logger.info('Step 3: Output generation');
          return { ...data, step3: true, complete: true };
        }
      })
      .build();

    logger.info('✅ Workflow created');

    // Execute workflow
    logger.info('\n📌 Executing workflow...');
    const result = await workflow.execute({ input: 'test data' });
    logger.info('Workflow result:', result);

    // 6. Use simple query (auto-selects best agent/approach)
    logger.info('\n📌 Using simple query...');
    try {
      const answer = await sdk.query('What is the capital of France?');
      logger.info('Query answer:', answer);
    } catch (error) {
      logger.error('Query error:', error);
    }

    // 7. Direct chat functionality
    logger.info('\n📌 Using chat functionality...');
    try {
      const chatResponse = await sdk.chat('Tell me a joke');
      logger.info('Chat response:', chatResponse);
    } catch (error) {
      logger.error('Chat error:', error);
    }

    // 8. Analysis functionality
    logger.info('\n📌 Using analysis functionality...');
    try {
      const analysis = await sdk.analyze({
        data: [10, 20, 30, 40, 50],
        type: 'statistical'
      });
      logger.info('Analysis result:', analysis);
    } catch (error) {
      logger.error('Analysis error:', error);
    }

    // 9. Check agent and workflow counts
    logger.info('\n📊 SDK Statistics:');
    logger.info(`  Agent templates: ${sdk.getAgentTemplates().join(', ')}`);
    logger.info(`  Workflow templates: ${sdk.getWorkflowTemplates().join(', ')}`);

    // 10. Shutdown
    logger.info('\n🛑 Shutting down...');
    await sdk.shutdown();
    logger.info('✅ Shutdown complete');

  } catch (error) {
    logger.error('❌ Example failed:', error);
    process.exit(1);
  }
}

// Helper function to demonstrate proper agent creation
async function createAgentProperly(sdk: TriProtocolSDK, name: string, template?: string) {
  const result = await sdk.createAgent(name, template);

  // Always check if it's a builder or an agent
  if (result && typeof result.build === 'function') {
    // It's a builder, needs to be built
    return await result.build();
  } else {
    // It's already an agent (from template)
    return result;
  }
}

// Run the example
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});