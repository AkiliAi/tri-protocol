/**
 * Unit Tests for MCPAdapter
 */

import { MCPAdapter } from '@protocols/mcp/MCPAdapter';
import { A2AMessageType } from '@protocols/a2a/types';
import type {
  A2AMessage,
  Message
} from '@protocols/a2a/types';
import type {
  MCPProtocolMessage,
  ToolExecutionRequest,
  ToolExecutionResponse,
  ResourceReadRequest,
  ResourceReadResponse
} from '@protocols/mcp/types';

describe('MCPAdapter', () => {
  let adapter: MCPAdapter;

  beforeEach(() => {
    adapter = new MCPAdapter({
      enabled: true,
      enableToolCaching: true,
      verboseLogging: false
    });
  });

  afterEach(async () => {
    await adapter.disconnect();
  });

  describe('Basic Operations', () => {
    it('should initialize correctly', () => {
      expect(adapter).toBeDefined();
      expect(adapter.getName()).toBe('mcp');
      expect(adapter.getVersion()).toBe('1.0.0');
    });

    it('should connect and disconnect', async () => {
      await expect(adapter.connect()).resolves.not.toThrow();
      expect(adapter.isActive()).toBe(true);

      await expect(adapter.disconnect()).resolves.not.toThrow();
      expect(adapter.isActive()).toBe(false);
    });

    it('should emit connection events', async () => {
      const onConnected = jest.fn();
      const onDisconnected = jest.fn();

      adapter.on('connected', onConnected);
      adapter.on('disconnected', onDisconnected);

      await adapter.connect();
      expect(onConnected).toHaveBeenCalled();

      await adapter.disconnect();
      expect(onDisconnected).toHaveBeenCalled();
    });

    it('should get capabilities', () => {
      const capabilities = adapter.getCapabilities();

      expect(capabilities).toHaveProperty('supportsBroadcast', false);
      expect(capabilities).toHaveProperty('supportsPrivateMessage', true);
      expect(capabilities).toHaveProperty('supportsStreaming', true);
      expect(capabilities).toHaveProperty('maxMessageSize');
      expect(capabilities).toHaveProperty('protocolVersion', '1.0.0');
    });
  });

  describe('Message Conversion', () => {
    describe('toMCPMessage', () => {
      it('should convert tool execution A2A message to MCP format', () => {
        const a2aMessage: A2AMessage = {
          id: 'msg-123',
          role: 'agent',
          type: A2AMessageType.TASK_REQUEST,
          from: 'agent-1',
          to: 'mcp-server',
          payload: {
            type: 'tool_execution',
            tool: 'read_file',
            args: { path: '/test.txt' }
          },
          timestamp: new Date(),
          priority: 'normal'
        };

        const mcpMessage = adapter.toMCPMessage(a2aMessage);

        expect(mcpMessage).toHaveProperty('type', 'tool_request');
        expect(mcpMessage).toHaveProperty('source', 'agent-1');
        expect(mcpMessage).toHaveProperty('target', 'mcp-server');
        expect(mcpMessage).toHaveProperty('payload');
        expect(mcpMessage.metadata).toHaveProperty('timestamp');
        expect(mcpMessage.metadata).toHaveProperty('priority', 'normal');
      });

      it('should convert resource read A2A message to MCP format', () => {
        const a2aMessage: A2AMessage = {
          id: 'msg-124',
          role: 'agent',
          type: A2AMessageType.TASK_REQUEST,
          from: 'agent-1',
          to: 'mcp-server',
          payload: {
            type: 'resource_read',
            uri: 'mock://test.txt'
          },
          timestamp: new Date(),
          priority: 'high'
        };

        const mcpMessage = adapter.toMCPMessage(a2aMessage);

        expect(mcpMessage).toHaveProperty('type', 'resource_request');
        expect(mcpMessage.metadata).toHaveProperty('priority', 'high');
      });

      it('should convert discovery A2A message to MCP format', () => {
        const a2aMessage: A2AMessage = {
          id: 'msg-125',
          role: 'agent',
          type: A2AMessageType.CAPABILITY_REQUEST,
          from: 'agent-1',
          to: 'mcp-server',
          payload: {
            type: 'discovery',
            target: 'tools'
          },
          timestamp: new Date(),
          priority: 'normal'
        };

        const mcpMessage = adapter.toMCPMessage(a2aMessage);

        expect(mcpMessage).toHaveProperty('type', 'discovery');
      });

      it('should handle urgent priority conversion', () => {
        const a2aMessage: A2AMessage = {
          id: 'msg-126',
          role: 'agent',
          type: A2AMessageType.TASK_REQUEST,
          from: 'agent-1',
          to: 'mcp-server',
          payload: { type: 'tool_execution' },
          timestamp: new Date(),
          priority: 'urgent'
        };

        const mcpMessage = adapter.toMCPMessage(a2aMessage);

        // 'urgent' should be converted to 'high' for MCP
        expect(mcpMessage.metadata?.priority).toBe('high');
      });
    });

    describe('fromMCPMessage', () => {
      it('should convert MCP message to A2A format', () => {
        const mcpMessage: MCPProtocolMessage = {
          type: 'tool_response',
          source: 'mcp-server',
          target: 'agent-1',
          payload: {
            result: 'success',
            data: { content: 'file contents' }
          },
          metadata: {
            timestamp: new Date(),
            correlationId: 'corr-123',
            priority: 'normal'
          }
        };

        const a2aMessage = adapter.fromMCPMessage(mcpMessage);

        expect(a2aMessage).toHaveProperty('id');
        expect(a2aMessage).toHaveProperty('role', 'agent');
        expect(a2aMessage).toHaveProperty('type', A2AMessageType.CAPABILITY_RESPONSE);
        expect(a2aMessage).toHaveProperty('from', 'mcp-server');
        expect(a2aMessage).toHaveProperty('to', 'agent-1');
        expect(a2aMessage).toHaveProperty('payload');
        expect(a2aMessage).toHaveProperty('timestamp');
        expect(a2aMessage).toHaveProperty('priority', 'normal');
        expect(a2aMessage).toHaveProperty('correlationId', 'corr-123');
      });

      it('should default to broadcast when target is not specified', () => {
        const mcpMessage: MCPProtocolMessage = {
          type: 'tool_response',
          source: 'mcp-server',
          payload: { result: 'success' }
        };

        const a2aMessage = adapter.fromMCPMessage(mcpMessage);

        expect(a2aMessage.to).toBe('broadcast');
      });
    });

    describe('toolExecutionToA2A', () => {
      it('should convert tool execution to A2A message', () => {
        const request: ToolExecutionRequest = {
          toolName: 'read_file',
          arguments: { path: '/test.txt' }
        };

        const response: ToolExecutionResponse = {
          success: true,
          result: { 
            content: [{
              type: 'text' as const,
              text: 'file contents'
            }]
          },
          duration: 100,
          serverName: 'test-server',
          toolName: 'read_file',
          timestamp: new Date()
        };

        const a2aMessage = adapter.toolExecutionToA2A(request, response);

        expect(a2aMessage).toHaveProperty('id');
        expect(a2aMessage).toHaveProperty('role', 'agent');
        expect(a2aMessage).toHaveProperty('type', A2AMessageType.TASK_RESPONSE);
        expect(a2aMessage).toHaveProperty('from', 'mcp-server:test-server');
        expect(a2aMessage).toHaveProperty('to', 'agent');
        expect(a2aMessage.payload).toHaveProperty('type', 'tool_execution_result');
        expect(a2aMessage.payload).toHaveProperty('tool', 'read_file');
        expect(a2aMessage.payload).toHaveProperty('success', true);
        expect(a2aMessage.payload).toHaveProperty('duration', 100);
        expect(a2aMessage.metadata).toHaveProperty('serverName', 'test-server');
      });

      it('should include error in failed execution', () => {
        const request: ToolExecutionRequest = {
          toolName: 'write_file',
          arguments: { path: '/test.txt', content: 'data' }
        };

        const response: ToolExecutionResponse = {
          success: false,
          error: 'Permission denied',
          duration: 50,
          serverName: 'test-server',
          toolName: 'write_file',
          timestamp: new Date()
        };

        const a2aMessage = adapter.toolExecutionToA2A(request, response);

        expect(a2aMessage.payload).toHaveProperty('success', false);
        expect(a2aMessage.payload).toHaveProperty('error', 'Permission denied');
      });
    });

    describe('resourceReadToA2A', () => {
      it('should convert resource read to A2A message', () => {
        const request: ResourceReadRequest = {
          uri: 'mock://test.txt'
        };

        const response: ResourceReadResponse = {
          success: true,
          contents: [{ 
            text: 'file contents',
            uri: 'mock://test.txt'
          }],
          serverName: 'test-server',
          uri: 'mock://test.txt',
          timestamp: new Date()
        };

        const a2aMessage = adapter.resourceReadToA2A(request, response);

        expect(a2aMessage).toHaveProperty('id');
        expect(a2aMessage).toHaveProperty('role', 'agent');
        expect(a2aMessage).toHaveProperty('type', A2AMessageType.TASK_RESPONSE);
        expect(a2aMessage).toHaveProperty('from', 'mcp-server:test-server');
        expect(a2aMessage.payload).toHaveProperty('type', 'resource_read_result');
        expect(a2aMessage.payload).toHaveProperty('uri', 'mock://test.txt');
        expect(a2aMessage.payload).toHaveProperty('success', true);
        expect(a2aMessage.metadata).toHaveProperty('resourceUri', 'mock://test.txt');
      });

      it('should include error in failed resource read', () => {
        const request: ResourceReadRequest = {
          uri: 'mock://missing.txt'
        };

        const response: ResourceReadResponse = {
          success: false,
          error: 'Resource not found',
          serverName: 'test-server',
          uri: 'mock://missing.txt',
          timestamp: new Date()
        };

        const a2aMessage = adapter.resourceReadToA2A(request, response);

        expect(a2aMessage.payload).toHaveProperty('success', false);
        expect(a2aMessage.payload).toHaveProperty('error', 'Resource not found');
      });
    });
  });

  describe('Message Sending', () => {
    it('should throw error when not connected', async () => {
      const message: A2AMessage = {
        id: 'msg-127',
        role: 'agent',
        type: A2AMessageType.TASK_REQUEST,
        from: 'agent-1',
        to: 'mcp-server',
        payload: { type: 'tool_execution' },
        timestamp: new Date(),
        priority: 'normal'
      };

      await expect(adapter.send(message)).rejects.toThrow('not connected');
    });

    it('should handle tool request messages', async () => {
      await adapter.connect();

      const message: A2AMessage = {
        id: 'msg-128',
        role: 'agent',
        type: A2AMessageType.TASK_REQUEST,
        from: 'agent-1',
        to: 'mcp-server',
        payload: {
          type: 'tool_execution',
          toolName: 'read_file',
          arguments: { path: '/test.txt' }
        },
        timestamp: new Date(),
        priority: 'normal'
      };

      // Mock the MCPManager executeTool method
      const executeSpy = jest.spyOn(adapter.getMCPManager(), 'executeTool')
        .mockResolvedValue({
          success: true,
          result: { 
            content: [{
              type: 'text' as const,
              text: 'file contents'
            }]
          },
          duration: 100,
          serverName: 'test-server',
          toolName: 'read_file',
          timestamp: new Date()
        });

      await adapter.send(message);

      expect(executeSpy).toHaveBeenCalled();
    });

    it('should handle resource request messages', async () => {
      await adapter.connect();

      const message: A2AMessage = {
        id: 'msg-129',
        role: 'agent',
        type: A2AMessageType.TASK_REQUEST,
        from: 'agent-1',
        to: 'mcp-server',
        payload: {
          type: 'resource_read',
          uri: 'mock://test.txt'
        },
        timestamp: new Date(),
        priority: 'normal'
      };

      // Mock the MCPManager readResource method
      const readSpy = jest.spyOn(adapter.getMCPManager(), 'readResource')
        .mockResolvedValue({
          success: true,
          contents: [{ 
            text: 'file contents',
            uri: 'mock://test.txt'
          }],
          serverName: 'test-server',
          uri: 'mock://test.txt',
          timestamp: new Date()
        });

      await adapter.send(message);

      expect(readSpy).toHaveBeenCalled();
    });

    // it('should handle discovery messages', async () => {
    //   await adapter.connect();
    //
    //   const message: A2AMessage = {
    //     id: 'msg-130',
    //     role: 'agent',
    //     type: A2AMessageType.CAPABILITY_REQUEST,
    //     from: 'agent-1',
    //     to: 'mcp-server',
    //     payload: {
    //       type: 'discovery',
    //       target: 'tools'
    //     },
    //     timestamp: new Date(),
    //     priority: 'normal'
    //   };
    //
    //   // Mock the MCPManager discoverAllTools method
    //   const discoverSpy = jest.spyOn(adapter.getMCPManager(), 'discoverAllTools')
    //     .mockResolvedValue(new Map([
    //       ['test-server', [
    //         {
    //           name: 'read_file',
    //           description: 'Read a file',
    //           serverName: 'test-server',
    //           discoveredAt: new Date(),
    //           inputSchema: {
    //             type: 'object' as const,
    //             properties: {}
    //           }
    //         }
    //       ]]
    //     ]));
    //
    //   await adapter.send(message);
    //
    //   expect(discoverSpy).toHaveBeenCalled();
    // });

    it('should emit message:received for responses', async () => {
      await adapter.connect();

      const onMessage = jest.fn();
      adapter.on('message:received', onMessage);

      const message: A2AMessage = {
        id: 'msg-131',
        role: 'agent',
        type: A2AMessageType.TASK_REQUEST,
        from: 'agent-1',
        to: 'mcp-server',
        payload: {
          type: 'tool_execution',
          toolName: 'read_file',
          arguments: { path: '/test.txt' }
        },
        timestamp: new Date(),
        priority: 'normal'
      };

      // Mock successful execution
      jest.spyOn(adapter.getMCPManager(), 'executeTool')
        .mockResolvedValue({
          success: true,
          result: { 
            content: [{
              type: 'text' as const,
              text: 'file contents'
            }]
          },
          duration: 100,
          serverName: 'test-server',
          toolName: 'read_file',
          timestamp: new Date()
        });

      await adapter.send(message);

      // Wait for async event emission
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(onMessage).toHaveBeenCalled();
    });
  });

  describe('MCP Manager Access', () => {
    it('should provide access to MCP manager', () => {
      const manager = adapter.getMCPManager();
      expect(manager).toBeDefined();
    });

    it('should connect to MCP server through adapter', async () => {
      const connection = {
        name: 'test-server',
        type: 'stdio' as const,
        command: 'node',
        args: ['server.js']
      };

      const connectSpy = jest.spyOn(adapter.getMCPManager(), 'connect')
        .mockResolvedValue(undefined);

      await adapter.connectMCPServer(connection);

      expect(connectSpy).toHaveBeenCalledWith(connection);
    });

    it('should disconnect from MCP server through adapter', async () => {
      const disconnectSpy = jest.spyOn(adapter.getMCPManager(), 'disconnect')
        .mockResolvedValue(undefined);

      await adapter.disconnectMCPServer('test-server');

      expect(disconnectSpy).toHaveBeenCalledWith('test-server');
    });

    it('should get available tools', () => {
      const mockTools = [
        {
          name: 'read_file',
          description: 'Read a file',
          serverName: 'test-server',
          discoveredAt: new Date(),
          inputSchema: {
            type: 'object' as const,
            properties: {}
          }
        }
      ];

      jest.spyOn(adapter.getMCPManager(), 'getAvailableTools')
        .mockReturnValue(mockTools);

      const tools = adapter.getAvailableTools();

      expect(tools).toEqual(mockTools);
    });

    it('should execute tool directly', async () => {
      const request: ToolExecutionRequest = {
        toolName: 'read_file',
        arguments: { path: '/test.txt' }
      };

      const mockResponse: ToolExecutionResponse = {
        success: true,
        result: { 
          content: [{
            type: 'text' as const,
            text: 'file contents'
          }]
        },
        duration: 100,
        serverName: 'test-server',
        toolName: 'read_file',
        timestamp: new Date()
      };

      jest.spyOn(adapter.getMCPManager(), 'executeTool')
        .mockResolvedValue(mockResponse);

      const response = await adapter.executeTool(request);

      expect(response).toEqual(mockResponse);
    });

    it('should list resources', async () => {
      const mockResources = [
        {
          uri: 'mock://test.txt',
          name: 'Test File',
          serverName: 'test-server'
        }
      ];

      jest.spyOn(adapter.getMCPManager(), 'listResources')
        .mockResolvedValue(mockResources);

      const resources = await adapter.listResources('test-server');

      expect(resources).toEqual(mockResources);
    });

    it('should read resource', async () => {
      const request: ResourceReadRequest = {
        uri: 'mock://test.txt'
      };

      const mockResponse: ResourceReadResponse = {
        success: true,
        contents: [{ 
          text: 'file contents',
          uri: 'mock://test.txt'
        }],
        serverName: 'test-server',
        uri: 'mock://test.txt',
        timestamp: new Date()
      };

      jest.spyOn(adapter.getMCPManager(), 'readResource')
        .mockResolvedValue(mockResponse);

      const response = await adapter.readResource(request);

      expect(response).toEqual(mockResponse);
    });

    it('should get adapter statistics', () => {
      const mockStats = {
        connectedServers: 1,
        totalTools: 5,
        totalResources: 3,
        totalToolCalls: 10,
        totalResourceReads: 5,
        totalErrors: 0
      };

      jest.spyOn(adapter.getMCPManager(), 'getStats')
        .mockReturnValue(mockStats);

      const stats = adapter.getStats();

      expect(stats).toHaveProperty('adapterConnected');
      expect(stats.connectedServers).toBe(1);
      expect(stats.totalTools).toBe(5);
    });
  });

  describe('Event Forwarding', () => {
    it('should forward MCP manager events', async () => {
      const onServerConnected = jest.fn();
      const onServerDisconnected = jest.fn();
      const onToolExecuted = jest.fn();
      const onResourceRead = jest.fn();
      const onError = jest.fn();

      adapter.on('mcp:server:connected', onServerConnected);
      adapter.on('mcp:server:disconnected', onServerDisconnected);
      adapter.on('message:received', onToolExecuted);
      adapter.on('message:received', onResourceRead);
      adapter.on('error', onError);

      // Emit events from the MCP manager
      const manager = adapter.getMCPManager();
      
      manager.emit('server:connected', 'test-server', { tools: {}, resources: {} });
      expect(onServerConnected).toHaveBeenCalledWith('test-server', expect.any(Object));

      manager.emit('server:disconnected', 'test-server', 'manual');
      expect(onServerDisconnected).toHaveBeenCalledWith('test-server', 'manual');

      manager.emit('tool:executed', {
        success: true,
        toolName: 'read_file',
        result: {
          content: []
        },
        duration: 100,
        serverName: 'test-server',
        timestamp: new Date()
      });
      
      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(onToolExecuted).toHaveBeenCalled();

      manager.emit('error', new Error('Test error'), { context: 'test' });
      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('Protocol Adapter Methods', () => {
    it('should return null for receive (push-based)', async () => {
      const result = await adapter.receive();
      expect(result).toBeNull();
    });

    it('should handle subscribe (no-op for MCP)', async () => {
      await expect(adapter.subscribe('topic')).resolves.not.toThrow();
    });

    it('should handle unsubscribe (no-op for MCP)', async () => {
      await expect(adapter.unsubscribe('topic')).resolves.not.toThrow();
    });
  });
});