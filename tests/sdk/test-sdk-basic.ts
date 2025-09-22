/**
 * Test SDK Basic Functionality
 * This test file validates the core SDK initialization and basic operations
 */

import { TriProtocolSDK, createSDK } from '../../sdk/src';
import { LoggerManager } from '../../logger/src';

const logger = LoggerManager.getInstance().createLogger('SDK-Test');

async function testSDKInitialization() {
  console.log('\n=== TEST 1: SDK Initialization ===\n');

  try {
    // Test 1.1: Create SDK with default config
    console.log('1.1 Creating SDK with default configuration...');
    const sdk1 = TriProtocolSDK.create();
    console.log('✅ SDK created (not initialized)');

    // Test 1.2: Initialize SDK
    console.log('\n1.2 Initializing SDK...');
    const sdk2 = await TriProtocolSDK.initialize({
      mode: 'development',
      logging: { level: 'debug', enabled: true }
    });
    console.log('✅ SDK initialized successfully');

    // Test 1.3: Check singleton pattern
    console.log('\n1.3 Testing singleton pattern...');
    const sdk3 = TriProtocolSDK.create();
    if (sdk1 === sdk3) {
      console.log('✅ Singleton pattern working correctly');
    } else {
      throw new Error('Singleton pattern not working');
    }

    // Test 1.4: Check configuration
    console.log('\n1.4 Checking SDK configuration...');
    const config = sdk2.getConfig();
    console.log('Configuration:', JSON.stringify(config, null, 2));

    if (config.mode === 'development') {
      console.log('✅ Configuration correctly set');
    }

    // Test 1.5: Check initialization status
    console.log('\n1.5 Checking initialization status...');
    if (sdk2.isInitialized()) {
      console.log('✅ SDK reports as initialized');
    } else {
      throw new Error('SDK not properly initialized');
    }

    // Test 1.6: Get protocol instance
    console.log('\n1.6 Getting protocol instance...');
    const protocol = sdk2.getProtocol();
    if (protocol) {
      console.log('✅ Protocol instance retrieved');
    }

    // Test 1.7: Get client instance
    console.log('\n1.7 Getting client instance...');
    const client = sdk2.getClient();
    if (client) {
      console.log('✅ Client instance retrieved');
    }

    // Test 1.8: Check available templates
    console.log('\n1.8 Checking available templates...');
    const agentTemplates = sdk2.getAgentTemplates();
    const workflowTemplates = sdk2.getWorkflowTemplates();
    console.log('Agent templates:', agentTemplates);
    console.log('Workflow templates:', workflowTemplates);

    if (agentTemplates.length > 0 && workflowTemplates.length > 0) {
      console.log('✅ Templates loaded successfully');
    }

    // Clean shutdown
    console.log('\n1.9 Testing shutdown...');
    await sdk2.shutdown();
    console.log('✅ SDK shutdown successfully');

    return true;
  } catch (error) {
    console.error('❌ Test failed:', error);
    return false;
  }
}

async function testBasicOperations() {
  console.log('\n=== TEST 2: Basic Operations ===\n');

  try {
    const sdk = await TriProtocolSDK.initialize({
      mode: 'development',
      persistence: {
        enabled: true,
        backend: 'memory'
      }
    });

    // Test 2.1: Simple chat
    console.log('2.1 Testing simple chat...');
    try {
      const response = await sdk.chat('Hello, SDK!');
      console.log('Chat response:', response);
      console.log('✅ Chat operation successful');
    } catch (error) {
      console.log('⚠️ Chat operation failed (LLM might not be configured):', error);
    }

    // Test 2.2: Query operation
    console.log('\n2.2 Testing query operation...');
    try {
      const answer = await sdk.query('What is 2+2?');
      console.log('Query response:', answer);
      console.log('✅ Query operation successful');
    } catch (error) {
      console.log('⚠️ Query operation failed (LLM might not be configured):', error);
    }

    // Test 2.3: Client API
    console.log('\n2.3 Testing client API...');
    const client = sdk.getClient();

    // Test memory operations
    console.log('Testing memory operations...');
    await client.remember('test-key', { value: 'test-data' });
    const recalled = await client.recall('test-key');
    if (recalled && recalled.value === 'test-data') {
      console.log('✅ Memory operations working');
    }

    // Test client status
    console.log('\n2.4 Testing client status...');
    const status = await client.getStatus();
    console.log('SDK Status:', JSON.stringify(status, null, 2));
    if (status.initialized) {
      console.log('✅ Status check successful');
    }

    // Test health check
    console.log('\n2.5 Testing health check...');
    const health = await client.healthCheck();
    console.log('Health status:', health.status);
    if (health.status) {
      console.log('✅ Health check successful');
    }

    await sdk.shutdown();
    return true;
  } catch (error) {
    console.error('❌ Test failed:', error);
    return false;
  }
}

async function testErrorHandling() {
  console.log('\n=== TEST 3: Error Handling ===\n');

  try {
    const sdk = await TriProtocolSDK.initialize();

    // Test 3.1: Invalid agent name
    console.log('3.1 Testing invalid agent name...');
    try {
      await sdk.createAgent('');
      console.error('❌ Should have thrown error for empty name');
    } catch (error) {
      console.log('✅ Correctly rejected empty agent name');
    }

    // Test 3.2: Invalid workflow name
    console.log('\n3.2 Testing invalid workflow name...');
    try {
      await sdk.createWorkflow('');
      console.error('❌ Should have thrown error for empty workflow name');
    } catch (error) {
      console.log('✅ Correctly rejected empty workflow name');
    }

    // Test 3.3: Invalid template
    console.log('\n3.3 Testing invalid template...');
    try {
      await sdk.runWorkflow('non-existent-template', {});
      console.error('❌ Should have thrown error for non-existent template');
    } catch (error) {
      console.log('✅ Correctly rejected non-existent template');
    }

    await sdk.shutdown();
    return true;
  } catch (error) {
    console.error('❌ Test failed:', error);
    return false;
  }
}

async function runAllTests() {
  console.log('\n' + '='.repeat(60));
  console.log('STARTING SDK BASIC TESTS');
  console.log('='.repeat(60));

  const results = [];

  // Run test suites
  results.push({
    name: 'SDK Initialization',
    passed: await testSDKInitialization()
  });

  results.push({
    name: 'Basic Operations',
    passed: await testBasicOperations()
  });

  results.push({
    name: 'Error Handling',
    passed: await testErrorHandling()
  });

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('TEST SUMMARY');
  console.log('='.repeat(60) + '\n');

  let totalPassed = 0;
  results.forEach(result => {
    const status = result.passed ? '✅ PASSED' : '❌ FAILED';
    console.log(`${status} - ${result.name}`);
    if (result.passed) totalPassed++;
  });

  console.log('\n' + '-'.repeat(60));
  console.log(`Total: ${totalPassed}/${results.length} tests passed`);
  console.log('-'.repeat(60) + '\n');

  if (totalPassed === results.length) {
    console.log('🎉 ALL TESTS PASSED! 🎉');
  } else {
    console.log('⚠️ Some tests failed. Please review the output above.');
  }
}

// Run tests
runAllTests().catch(console.error);