/**
 * Integration Tests for MCP-A2A Protocol Integration
 * Tests the complete flow from A2A agents using MCP tools
 */

import { TriAgent, TriAgentConfig } from '../../core/src/TriAgent';
import { TriProtocol } from '../../core/src/TriProtocol';
import { TriRegistry } from '../../core/src/TriRegistry';
import { Logger } from '../../logger';
import { MockMCPServer, MockMCPServerFactory } from '../../protocols/src/utils/mock-mcp-server';
import type {
  Message,
  Task,
  AgentCapability,
  A2AMessage
} from '../../protocols/src/a2a/types';
import type {
  MCPServerConnection,
  ToolExecutionResponse
} from '../../protocols/src/mcp/types';

// Test Agent with MCP capabilities
class TestMCPAgent extends TriAgent {
  public receivedMessages: Message[] = [];
  public executedTools: { name: string; args: any; result: any }[] = [];

  constructor(id: string, enableMCP: boolean = true) {
    const config: TriAgentConfig = {
      id,
      name: `TestAgent-${id}`,
      type: 'test',
      description: 'Test agent with MCP support',
      capabilities: [
        {
          name: 'process_data',
          description: 'Process data using MCP tools',
          inputSchema: {
            type: 'object',
            properties: {
              action: { type: 'string' },
              data: { type: 'any' }
            }
          },
          outputSchema: {
            type: 'object',
            properties: {
              result: { type: 'any' }
            }
          }
        }
      ],
      enableMCP,
      mcpConfig: enableMCP ? {
        enabled: true,
        autoDiscoverTools: true,
        enableToolCaching: true,
        defaultTimeout: 5000
      } : undefined
    };

    super(config);
  }

  async processMessage(message: Message): Promise<Message> {
    this.receivedMessages.push(message);

    const content = message.parts[0]?.data;
    
    if (content?.action === 'use_mcp_tool') {
      const { toolName, args } = content;
      
      if (this.isMCPEnabled()) {
        const result = await this.useTool(toolName, args);
        this.executedTools.push({ name: toolName, args, result });
        
        return this.createResponse({
          success: result.success,
          result: result.result,
          duration: result.duration
        });
      } else {
        return this.createResponse({
          error: 'MCP not enabled'
        });
      }
    }

    if (content?.action === 'list_tools') {
      const tools = this.getAvailableTools();
      return this.createResponse({
        tools: tools.map(t => ({ name: t.name, description: t.description }))
      });
    }

    if (content?.action === 'read_resource') {
      const { uri } = content;
      const result = await this.readResource(uri);
      return this.createResponse({
        success: result.success,
        contents: result.contents
      });
    }

    return this.createResponse({ processed: true });
  }

  async processTask(task: Task): Promise<void> {
    // Task processing logic
    this.logger.debug('Processing task', { taskId: task.id });
  }

  private createResponse(data: any): Message {
    return {
      role: 'agent',
      parts: [{ kind: 'data', data }],
      messageId: `${this.config.id}-${Date.now()}`,
      kind: 'message'
    };
  }

  async connectToMockServer(mockServer: MockMCPServer): Promise<void> {
    const connection: MCPServerConnection = {
      name: mockServer.getInfo().name,
      type: 'stdio',
      command: 'node',
      args: ['mock-server.js']
    };

    await this.connectMCPServer(connection);
  }
}

describe('MCP-A2A Integration', () => {
  let protocol: TriProtocol;
  let registry: TriRegistry;
  let agentWithMCP: TestMCPAgent;
  let agentWithoutMCP: TestMCPAgent;
  let mockServer: MockMCPServer;
  let logger: Logger;

  beforeAll(() => {
    logger = Logger.getLogger('MCP-A2A-Integration-Test');
  });

  beforeEach(async () => {
    // Initialize Tri-Protocol components
    registry = new TriRegistry();
    protocol = new TriProtocol();
    await protocol.initialize(registry);

    // Create agents
    agentWithMCP = new TestMCPAgent('agent-mcp', true);
    agentWithoutMCP = new TestMCPAgent('agent-no-mcp', false);

    // Connect agents to protocol
    await agentWithMCP.connect(protocol);
    await agentWithoutMCP.connect(protocol);

    // Create and start mock MCP server
    mockServer = MockMCPServerFactory.createFilesystemServer('test-mcp-server');
    
    // Add custom tools for testing
    mockServer.addTool({
      name: 'calculate',
      description: 'Perform calculation',
      inputSchema: {
        type: 'object',
        properties: {
          operation: { type: 'string' },
          a: { type: 'number' },
          b: { type: 'number' }
        }
      },
      handler: async (args: any) => {
        const { operation, a, b } = args;
        let result;
        switch (operation) {
          case 'add': result = a + b; break;
          case 'subtract': result = a - b; break;
          case 'multiply': result = a * b; break;
          case 'divide': result = b !== 0 ? a / b : 'Error: Division by zero';
          break;
          default: result = 'Unknown operation';
        }
        return { result, operation, inputs: { a, b } };
      }
    });

    // Connect agent to mock MCP server
    await agentWithMCP.connectToMockServer(mockServer);
  });

  afterEach(async () => {
    // Cleanup
    await agentWithMCP.disconnect();
    await agentWithoutMCP.disconnect();
    await protocol.shutdown();
    await mockServer.stop();
  });

  describe('Basic MCP-A2A Communication', () => {
    it('should allow agents to discover MCP tools', async () => {
      const response = await agentWithoutMCP.sendToAgent('agent-mcp', {
        action: 'list_tools'
      });

      expect(response).toBeDefined();
      expect(response.parts[0].data.tools).toBeDefined();
      expect(response.parts[0].data.tools.length).toBeGreaterThan(0);
      
      const tools = response.parts[0].data.tools;
      const calculateTool = tools.find((t: any) => t.name === 'calculate');
      expect(calculateTool).toBeDefined();
    });

    it('should execute MCP tools through A2A communication', async () => {
      const response = await agentWithoutMCP.sendToAgent('agent-mcp', {
        action: 'use_mcp_tool',
        toolName: 'calculate',
        args: {
          operation: 'add',
          a: 5,
          b: 3
        }
      });

      expect(response.parts[0].data.success).toBe(true);
      expect(response.parts[0].data.result).toBeDefined();
      expect(response.parts[0].data.result.result).toBe(8);
    });

    it('should handle MCP tool errors gracefully', async () => {
      const response = await agentWithoutMCP.sendToAgent('agent-mcp', {
        action: 'use_mcp_tool',
        toolName: 'non_existent_tool',
        args: {}
      });

      expect(response.parts[0].data.success).toBe(false);
    });

    it('should read MCP resources through A2A', async () => {
      // Add a test resource to mock server
      mockServer.addResource({
        uri: 'test://data.json',
        name: 'Test Data',
        mimeType: 'application/json',
        contents: { test: 'data', value: 123 }
      });

      const response = await agentWithoutMCP.sendToAgent('agent-mcp', {
        action: 'read_resource',
        uri: 'test://data.json'
      });

      expect(response.parts[0].data.success).toBe(true);
      expect(response.parts[0].data.contents).toBeDefined();
    });
  });

  describe('MCP Tool Execution Tracking', () => {
    it('should track tool executions', async () => {
      await agentWithoutMCP.sendToAgent('agent-mcp', {
        action: 'use_mcp_tool',
        toolName: 'calculate',
        args: { operation: 'multiply', a: 4, b: 5 }
      });

      expect(agentWithMCP.executedTools).toHaveLength(1);
      expect(agentWithMCP.executedTools[0].name).toBe('calculate');
      expect(agentWithMCP.executedTools[0].result.success).toBe(true);
    });

    it('should get MCP statistics', () => {
      const stats = agentWithMCP.getMCPStats();
      
      expect(stats).toBeDefined();
      expect(stats.connectedServers).toBeGreaterThanOrEqual(0);
      expect(stats.totalTools).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Multiple Agent MCP Coordination', () => {
    let agentMCP2: TestMCPAgent;

    beforeEach(async () => {
      // Create another MCP-enabled agent
      agentMCP2 = new TestMCPAgent('agent-mcp-2', true);
      await agentMCP2.connect(protocol);
      await agentMCP2.connectToMockServer(mockServer);
    });

    afterEach(async () => {
      await agentMCP2.disconnect();
    });

    it('should allow multiple agents to use same MCP server', async () => {
      // Both agents execute tools
      const response1 = await agentWithoutMCP.sendToAgent('agent-mcp', {
        action: 'use_mcp_tool',
        toolName: 'calculate',
        args: { operation: 'add', a: 10, b: 20 }
      });

      const response2 = await agentWithoutMCP.sendToAgent('agent-mcp-2', {
        action: 'use_mcp_tool',
        toolName: 'calculate',
        args: { operation: 'subtract', a: 50, b: 30 }
      });

      expect(response1.parts[0].data.result.result).toBe(30);
      expect(response2.parts[0].data.result.result).toBe(20);

      // Check server statistics
      const serverStats = mockServer.getStats();
      expect(serverStats.totalCalls).toBeGreaterThanOrEqual(2);
    });

    it('should handle concurrent MCP operations', async () => {
      const promises = [];

      // Launch multiple concurrent operations
      for (let i = 0; i < 5; i++) {
        promises.push(
          agentWithoutMCP.sendToAgent('agent-mcp', {
            action: 'use_mcp_tool',
            toolName: 'calculate',
            args: { operation: 'add', a: i, b: i * 2 }
          })
        );

        promises.push(
          agentWithoutMCP.sendToAgent('agent-mcp-2', {
            action: 'use_mcp_tool',
            toolName: 'calculate',
            args: { operation: 'multiply', a: i, b: 3 }
          })
        );
      }

      const results = await Promise.all(promises);
      
      expect(results).toHaveLength(10);
      results.forEach(result => {
        expect(result.parts[0].data.success).toBe(true);
      });
    });
  });

  describe('MCP Server Failures and Recovery', () => {
    it('should handle MCP server disconnection', async () => {
      // Stop the mock server
      await mockServer.stop();

      // Try to use a tool
      const response = await agentWithoutMCP.sendToAgent('agent-mcp', {
        action: 'use_mcp_tool',
        toolName: 'calculate',
        args: { operation: 'add', a: 1, b: 1 }
      });

      // Should fail gracefully
      expect(response.parts[0].data.success).toBe(false);
    });

    it('should work with agents that dont have MCP enabled', async () => {
      const response = await agentWithMCP.sendToAgent('agent-no-mcp', {
        action: 'process_data',
        data: { test: 'data' }
      });

      expect(response).toBeDefined();
      expect(response.parts[0].data.processed).toBe(true);
    });
  });

  describe('Complex MCP Workflows', () => {
    it('should support chained MCP operations', async () => {
      // First operation: calculate
      const calc1 = await agentWithoutMCP.sendToAgent('agent-mcp', {
        action: 'use_mcp_tool',
        toolName: 'calculate',
        args: { operation: 'multiply', a: 5, b: 4 }
      });

      const result1 = calc1.parts[0].data.result.result;

      // Second operation: use result from first
      const calc2 = await agentWithoutMCP.sendToAgent('agent-mcp', {
        action: 'use_mcp_tool',
        toolName: 'calculate',
        args: { operation: 'add', a: result1, b: 10 }
      });

      expect(calc2.parts[0].data.result.result).toBe(30); // (5*4) + 10
    });

    it('should support mixed MCP and non-MCP operations', async () => {
      // MCP operation
      const mcpResponse = await agentWithoutMCP.sendToAgent('agent-mcp', {
        action: 'use_mcp_tool',
        toolName: 'calculate',
        args: { operation: 'add', a: 10, b: 5 }
      });

      expect(mcpResponse.parts[0].data.success).toBe(true);

      // Non-MCP operation
      const normalResponse = await agentWithoutMCP.sendToAgent('agent-mcp', {
        action: 'process_data',
        data: { value: mcpResponse.parts[0].data.result.result }
      });

      expect(normalResponse.parts[0].data.processed).toBe(true);
    });
  });

  describe('MCP Event Handling', () => {
    it('should emit MCP events during operations', async () => {
      const events: any[] = [];
      
      agentWithMCP.on('mcp:tool:executed', (response) => {
        events.push({ type: 'tool:executed', response });
      });

      await agentWithoutMCP.sendToAgent('agent-mcp', {
        action: 'use_mcp_tool',
        toolName: 'calculate',
        args: { operation: 'add', a: 1, b: 2 }
      });

      // Wait for events to be processed
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(events.length).toBeGreaterThan(0);
      expect(events[0].type).toBe('tool:executed');
    });
  });

  describe('Performance and Caching', () => {
    it('should cache tool discovery results', async () => {
      const start1 = Date.now();
      await agentWithoutMCP.sendToAgent('agent-mcp', {
        action: 'list_tools'
      });
      const time1 = Date.now() - start1;

      const start2 = Date.now();
      await agentWithoutMCP.sendToAgent('agent-mcp', {
        action: 'list_tools'
      });
      const time2 = Date.now() - start2;

      // Second call should be faster due to caching
      expect(time2).toBeLessThanOrEqual(time1);
    });

    it('should handle rapid successive MCP calls', async () => {
      const promises = [];
      const count = 20;

      for (let i = 0; i < count; i++) {
        promises.push(
          agentWithoutMCP.sendToAgent('agent-mcp', {
            action: 'use_mcp_tool',
            toolName: 'calculate',
            args: { operation: 'add', a: i, b: 1 }
          })
        );
      }

      const results = await Promise.all(promises);
      
      expect(results).toHaveLength(count);
      results.forEach((result, index) => {
        expect(result.parts[0].data.success).toBe(true);
        expect(result.parts[0].data.result.result).toBe(index + 1);
      });
    });
  });
});