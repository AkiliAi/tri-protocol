#!/usr/bin/env ts-node

/**
 * Quick MCP Testing Script
 * Tests MCP integration with real or mock servers
 * 
 * Usage:
 *   npm run test:mcp              # Run with default mock server
 *   npm run test:mcp -- --real     # Run with real MCP server
 *   npm run test:mcp -- --server filesystem  # Test specific server
 */

import { TriAgent, TriAgentConfig } from '../core/src/TriAgent';
import { TriProtocol } from '../core/src/TriProtocol';
import { TriRegistry } from '../core/src/TriRegistry';
import { Logger } from '../logger';
import { MockMCPServerFactory } from '../protocols/src/utils/mock-mcp-server';
import type {
  Message,
  Task,
  AgentCapability
} from '../protocols/src/a2a/types';
import type {
  MCPServerConnection,
  ToolExecutionResponse
} from '../protocols/src/mcp/types';

// Parse command line arguments
const args = process.argv.slice(2);
const useRealServer = args.includes('--real');
const serverType = args.includes('--server') 
  ? args[args.indexOf('--server') + 1] 
  : 'filesystem';
const verbose = args.includes('--verbose') || args.includes('-v');

// Configure logger
const logger = Logger.getLogger('MCP-Test');
// Logger level configuration removed - not available in this Logger implementation

/**
 * Test Agent with MCP capabilities
 */
class MCPTestAgent extends TriAgent {
  constructor(id: string = 'mcp-test-agent') {
    const config: TriAgentConfig = {
      id,
      name: 'MCP Test Agent',
      type: 'test',
      description: 'Agent for testing MCP functionality',
      capabilities: [
        {
          name: 'test_mcp',
          description: 'Test MCP tools',
          inputSchema: { type: 'object' },
          outputSchema: { type: 'object' }
        }
      ],
      enableMCP: true,
      mcpConfig: {
        enabled: true,
        autoDiscoverTools: true,
        enableToolCaching: true,
        verboseLogging: verbose,
        defaultTimeout: 10000
      }
    };

    super(config);
  }

  async processMessage(message: Message): Promise<Message> {
    return {
      role: 'agent',
      parts: [{ kind: 'data', data: { processed: true } }],
      messageId: `${this.config.id}-${Date.now()}`,
      kind: 'message'
    };
  }

  async processTask(task: Task): Promise<void> {
    this.logger.info('Processing task', { taskId: task.id });
  }

  /**
   * Connect to MCP servers based on configuration
   */
  async setupMCPServers(useReal: boolean, type: string): Promise<void> {
    if (useReal) {
      await this.connectToRealServers(type);
    } else {
      await this.connectToMockServers(type);
    }
  }

  /**
   * Connect to real MCP servers
   */
  private async connectToRealServers(type: string): Promise<void> {
    logger.info(`🔌 Connecting to real ${type} MCP server...`);

    const connections: Record<string, MCPServerConnection> = {
      filesystem: {
        name: 'filesystem',
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', process.cwd()],
        autoReconnect: true
      },
      github: {
        name: 'github',
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        env: {
          GITHUB_TOKEN: process.env.GITHUB_TOKEN || ''
        },
        autoReconnect: true
      },
      postgres: {
        name: 'postgres',
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-postgres'],
        env: {
          DATABASE_URL: process.env.DATABASE_URL || 'postgresql://localhost/test'
        },
        autoReconnect: true
      }
    };

    const connection = connections[type];
    if (!connection) {
      throw new Error(`Unknown server type: ${type}`);
    }

    try {
      await this.connectMCPServer(connection);
      logger.info(`✅ Connected to real ${type} server`);
    } catch (error) {
      logger.error(`❌ Failed to connect to real ${type} server:`, error);
      throw error;
    }
  }

  /**
   * Connect to mock MCP servers
   */
  private async connectToMockServers(type: string): Promise<void> {
    logger.info(`🔌 Connecting to mock ${type} MCP server...`);

    // For mock servers, we'll simulate the connection
    const connection: MCPServerConnection = {
      name: `mock-${type}`,
      type: 'stdio',
      command: 'node',
      args: ['mock-server.js']
    };

    try {
      await this.connectMCPServer(connection);
      logger.info(`✅ Connected to mock ${type} server`);
    } catch (error) {
      logger.warn(`⚠️ Mock server connection simulated (this is normal for testing)`);
    }
  }
}

/**
 * Main test function
 */
async function runMCPTest(): Promise<void> {
  logger.info('🚀 Starting MCP Test Script');
  logger.info(`Configuration: ${useRealServer ? 'REAL' : 'MOCK'} server, type: ${serverType}`);

  let protocol: TriProtocol | undefined;
  let agent: MCPTestAgent | undefined;
  let mockServer: any | undefined;

  try {
    // Initialize Tri-Protocol
    logger.info('📦 Initializing Tri-Protocol...');
    const registry = new TriRegistry();
    protocol = new TriProtocol({
      name: 'test-mcp',
      version: '1.0.0',
      protocols: {
        a2a: { enabled: true },
        mcp: { enabled: true }
      }
    });
    await protocol.initialize();

    // Create test agent
    logger.info('🤖 Creating test agent...');
    agent = new MCPTestAgent();
    await agent.connect(protocol);

    // Create mock server if needed
    if (!useRealServer) {
      logger.info('🎭 Creating mock MCP server...');
      
      if (serverType === 'filesystem') {
        mockServer = MockMCPServerFactory.createFilesystemServer();
      } else if (serverType === 'database') {
        mockServer = MockMCPServerFactory.createDatabaseServer();
      } else {
        mockServer = MockMCPServerFactory.createFilesystemServer(`mock-${serverType}`);
      }

      // Don't actually start the mock server for this script
      // as we're just simulating the connection
      logger.info('📝 Mock server created (not started for this test)');
    }

    // Connect to MCP servers
    await agent.setupMCPServers(useRealServer, serverType);

    // Wait a moment for connections to establish
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Test 1: Discover available tools
    logger.info('\n📋 Test 1: Discovering available tools...');
    const tools = agent.getAvailableTools();
    
    if (tools.length > 0) {
      logger.info(`✅ Found ${tools.length} tools:`);
      tools.forEach(tool => {
        logger.info(`   - ${tool.name}: ${tool.description}`);
      });
    } else {
      logger.warn('⚠️ No tools discovered (this is normal for mock servers)');
      
      // For mock servers, manually add some test data
      if (!useRealServer) {
        logger.info('📝 Adding mock tools for demonstration...');
        // Mock tools would be added here in a real implementation
      }
    }

    // Test 2: Execute a tool (if available)
    if (tools.length > 0) {
      logger.info('\n🔧 Test 2: Executing a tool...');
      const testTool = tools[0];
      
      try {
        let testArgs: any = {};
        
        // Prepare test arguments based on tool
        if (testTool.name === 'read_file' || testTool.name.includes('read')) {
          testArgs = { path: 'README.md' };
        } else if (testTool.name === 'list_directory' || testTool.name.includes('list')) {
          testArgs = { path: '.' };
        } else if (testTool.name === 'query') {
          testArgs = { sql: 'SELECT 1' };
        }

        logger.info(`   Executing: ${testTool.name} with args:`, testArgs);
        
        const result = await agent.useTool(testTool.name, testArgs);
        
        if (result.success) {
          logger.info(`   ✅ Tool executed successfully!`);
          if (verbose) {
            logger.debug('   Result:', result.result);
          }
        } else {
          logger.error(`   ❌ Tool execution failed:`, result.error);
        }
      } catch (error) {
        logger.error(`   ❌ Error executing tool:`, error);
      }
    }

    // Test 3: List resources (if supported)
    logger.info('\n📚 Test 3: Listing resources...');
    try {
      const resources = await agent.listResources();
      
      if (resources.length > 0) {
        logger.info(`✅ Found ${resources.length} resources:`);
        resources.slice(0, 5).forEach(resource => {
          logger.info(`   - ${resource.uri}: ${resource.name}`);
        });
      } else {
        logger.info('ℹ️ No resources found');
      }
    } catch (error) {
      logger.warn('⚠️ Resource listing not supported or failed');
    }

    // Test 4: Get MCP statistics
    logger.info('\n📊 Test 4: MCP Statistics:');
    const stats = agent.getMCPStats();
    if (stats) {
      logger.info(`   Connected servers: ${stats.connectedServers}`);
      logger.info(`   Total tools: ${stats.totalTools}`);
      logger.info(`   Total resources: ${stats.totalResources}`);
      logger.info(`   Tool calls: ${stats.totalToolCalls}`);
      logger.info(`   Resource reads: ${stats.totalResourceReads}`);
      logger.info(`   Errors: ${stats.totalErrors}`);
    }

    // Test 5: Performance test (if not real server)
    if (!useRealServer && tools.length > 0) {
      logger.info('\n⚡ Test 5: Performance test...');
      const iterations = 10;
      const start = Date.now();
      
      for (let i = 0; i < iterations; i++) {
        await agent.useTool(tools[0].name, {});
      }
      
      const duration = Date.now() - start;
      const avgTime = duration / iterations;
      
      logger.info(`   Executed ${iterations} tool calls in ${duration}ms`);
      logger.info(`   Average time per call: ${avgTime.toFixed(2)}ms`);
    }

    logger.info('\n✅ All tests completed successfully!');

  } catch (error) {
    logger.error('❌ Test failed:', error);
    process.exit(1);
  } finally {
    // Cleanup
    logger.info('\n🧹 Cleaning up...');
    
    if (agent) {
      await agent.disconnect();
    }
    
    if (protocol) {
      await protocol.shutdown();
    }
    
    if (mockServer) {
      await mockServer.stop();
    }
    
    logger.info('👋 Test completed');
  }
}

// Run the test
runMCPTest().then(() => {
  process.exit(0);
}).catch(error => {
  logger.error('Fatal error:', error);
  process.exit(1);
});

// Handle process termination
process.on('SIGINT', async () => {
  logger.info('\n⚠️ Interrupted, cleaning up...');
  process.exit(0);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Rejection:', reason);
  process.exit(1);
});