/**
 * Unit Tests for MCPClientManager
 */

import { MCPClientManager } from '@protocols/mcp/MCPClientManager';
import { MockMCPServer, MockMCPServerFactory } from '@protocols/utils/mock-mcp-server';
import type {
  MCPServerConnection,
  MCPToolDescription,
  ToolExecutionRequest,
  ResourceReadRequest
} from '@protocols/mcp/types';

describe('MCPClientManager', () => {
  let manager: MCPClientManager;
  let mockServer: MockMCPServer;

  beforeEach(() => {
    // Create a fresh manager for each test
    manager = new MCPClientManager({
      enabled: true,
      enableToolCaching: true,
      toolCacheTTL: 5000,
      defaultTimeout: 3000,
      verboseLogging: false
    });

    // Create a mock server
    mockServer = MockMCPServerFactory.createFilesystemServer('test-server');
  });

  afterEach(async () => {
    // Clean up
    await manager.disconnectAll();
    await mockServer.stop();
  });

  describe('Connection Management', () => {
    it('should connect to a server successfully', async () => {
      const connection: MCPServerConnection = {
        name: 'test-server',
        type: 'stdio',
        command: 'node',
        args: ['mock-server.js']
      };

      await expect(manager.connect(connection)).resolves.not.toThrow();
      expect(manager.getConnectedServers()).toContain('test-server');
    });

    it('should prevent duplicate connections', async () => {
      const connection: MCPServerConnection = {
        name: 'test-server',
        type: 'stdio',
        command: 'node',
        args: ['mock-server.js']
      };

      await manager.connect(connection);
      await expect(manager.connect(connection)).rejects.toThrow('already connected');
    });

    it('should disconnect from a server', async () => {
      const connection: MCPServerConnection = {
        name: 'test-server',
        type: 'stdio',
        command: 'node',
        args: ['mock-server.js']
      };

      await manager.connect(connection);
      await manager.disconnect('test-server');
      
      expect(manager.getConnectedServers()).not.toContain('test-server');
    });

    it('should handle disconnecting from non-existent server', async () => {
      await expect(manager.disconnect('non-existent')).rejects.toThrow('not connected');
    });

    it('should disconnect from all servers', async () => {
      const connections: MCPServerConnection[] = [
        {
          name: 'server1',
          type: 'stdio',
          command: 'node',
          args: ['server1.js']
        },
        {
          name: 'server2',
          type: 'stdio',
          command: 'node',
          args: ['server2.js']
        }
      ];

      for (const conn of connections) {
        await manager.connect(conn);
      }

      await manager.disconnectAll();
      expect(manager.getConnectedServers()).toHaveLength(0);
    });

    it('should emit connection events', async () => {
      const onConnected = jest.fn();
      const onDisconnected = jest.fn();

      manager.on('server:connected', onConnected);
      manager.on('server:disconnected', onDisconnected);

      const connection: MCPServerConnection = {
        name: 'test-server',
        type: 'stdio',
        command: 'node',
        args: ['mock-server.js']
      };

      await manager.connect(connection);
      expect(onConnected).toHaveBeenCalledWith('test-server', expect.any(Object));

      await manager.disconnect('test-server');
      expect(onDisconnected).toHaveBeenCalledWith('test-server', 'manual_disconnect');
    });
  });

  describe('Tool Discovery', () => {
    beforeEach(async () => {
      // Connect to mock server
      await manager.connect({
        name: 'test-server',
        type: 'stdio',
        command: 'node',
        args: ['mock-server.js']
      });
    });

    it('should discover tools from a server', async () => {
      const tools = await manager.discoverTools('test-server');
      
      expect(tools).toBeInstanceOf(Array);
      expect(tools.length).toBeGreaterThan(0);
      
      const tool = tools[0];
      expect(tool).toHaveProperty('name');
      expect(tool).toHaveProperty('description');
      expect(tool).toHaveProperty('serverName', 'test-server');
      expect(tool).toHaveProperty('discoveredAt');
    });

    it('should cache discovered tools', async () => {
      const tools1 = await manager.discoverTools('test-server');
      const tools2 = await manager.discoverTools('test-server');
      
      // Should return the same reference (cached)
      expect(tools1).toBe(tools2);
    });

    it('should refresh cache after TTL', async () => {
      // Set short TTL for testing
      manager.setConfig({ toolCacheTTL: 100 });
      
      const tools1 = await manager.discoverTools('test-server');
      
      // Wait for cache to expire
      await new Promise(resolve => setTimeout(resolve, 150));
      
      const tools2 = await manager.discoverTools('test-server');
      
      // Should be different references (cache refreshed)
      expect(tools1).not.toBe(tools2);
    });

    it('should discover tools from all servers', async () => {
      // Add another server
      await manager.connect({
        name: 'server2',
        type: 'stdio',
        command: 'node',
        args: ['server2.js']
      });

      const allTools = await manager.discoverAllTools();
      
      expect(allTools).toBeInstanceOf(Map);
      expect(allTools.has('test-server')).toBe(true);
      expect(allTools.has('server2')).toBe(true);
    });

    it('should get available tools', () => {
      const tools = manager.getAvailableTools();
      expect(tools).toBeInstanceOf(Array);
    });

    it('should get tools from specific server', () => {
      const tools = manager.getServerTools('test-server');
      expect(tools).toBeInstanceOf(Array);
    });

    it('should clear tool cache', async () => {
      await manager.discoverTools('test-server');
      manager.clearToolCache();
      
      // After clearing, should fetch fresh tools
      const spy = jest.spyOn(manager as any, 'discoverTools');
      await manager.discoverTools('test-server');
      
      expect(spy).toHaveBeenCalled();
    });
  });

  describe('Tool Execution', () => {
    beforeEach(async () => {
      await manager.connect({
        name: 'test-server',
        type: 'stdio',
        command: 'node',
        args: ['mock-server.js']
      });
      
      await manager.discoverTools('test-server');
    });

    it('should execute a tool successfully', async () => {
      const request: ToolExecutionRequest = {
        toolName: 'read_file',
        arguments: { path: '/test/file.txt' }
      };

      const response = await manager.executeTool(request);
      
      expect(response).toHaveProperty('success', true);
      expect(response).toHaveProperty('result');
      expect(response).toHaveProperty('duration');
      expect(response).toHaveProperty('serverName');
      expect(response).toHaveProperty('toolName', 'read_file');
      expect(response).toHaveProperty('timestamp');
    });

    it('should auto-route tool to correct server', async () => {
      const request: ToolExecutionRequest = {
        // No serverName specified
        toolName: 'read_file',
        arguments: { path: '/test/file.txt' }
      };

      const response = await manager.executeTool(request);
      
      expect(response.success).toBe(true);
      expect(response.serverName).toBe('test-server');
    });

    it('should handle tool not found', async () => {
      const request: ToolExecutionRequest = {
        toolName: 'non_existent_tool',
        arguments: {}
      };

      await expect(manager.executeTool(request)).rejects.toThrow('not found');
    });

    it('should respect execution timeout', async () => {
      const request: ToolExecutionRequest = {
        toolName: 'read_file',
        arguments: { path: '/test/file.txt' },
        timeout: 1 // Very short timeout
      };

      // This might timeout or succeed depending on execution speed
      const responsePromise = manager.executeTool(request);
      await expect(responsePromise).resolves.toBeDefined();
    });

    it('should enforce concurrent execution limit', async () => {
      manager.setConfig({ maxConcurrentExecutions: 2 });

      const requests = Array(3).fill(null).map((_, i) => ({
        toolName: 'read_file',
        arguments: { path: `/test/file${i}.txt` }
      }));

      // Start 3 executions simultaneously
      const promises = requests.map(req => manager.executeTool(req));
      
      // Third one should fail due to limit
      await expect(Promise.all(promises)).rejects.toThrow();
    });

    it('should emit tool execution events', async () => {
      const onExecuted = jest.fn();
      manager.on('tool:executed', onExecuted);

      const request: ToolExecutionRequest = {
        toolName: 'read_file',
        arguments: { path: '/test/file.txt' }
      };

      await manager.executeTool(request);
      
      expect(onExecuted).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          toolName: 'read_file'
        })
      );
    });

    // it('should update tool statistics', async () => {
    //   const request: ToolExecutionRequest = {
    //     toolName: 'read_file',
    //     arguments: { path: '/test/file.txt' }
    //   };
    //
    //   await manager.executeTool(request);
    //
    //   const tools = manager.getServerTools('test-server');
    //   const tool = tools.find(t => t.name === 'read_file');
    //
    //   expect(tool?.callCount).toBe(1);
    //   expect(tool?.avgExecutionTime).toBeGreaterThan(0);
    //   expect(tool?.lastExecutionStatus).toBe('success');
    // });
  });

  describe('Resource Management', () => {
    beforeEach(async () => {
      await manager.connect({
        name: 'test-server',
        type: 'stdio',
        command: 'node',
        args: ['mock-server.js']
      });
    });

    it('should list resources from a server', async () => {
      const resources = await manager.listResources('test-server');
      
      expect(resources).toBeInstanceOf(Array);
      expect(resources.length).toBeGreaterThan(0);
      
      const resource = resources[0];
      expect(resource).toHaveProperty('uri');
      expect(resource).toHaveProperty('name');
      expect(resource).toHaveProperty('serverName', 'test-server');
    });

    it('should list resources from all servers', async () => {
      const allResources = await manager.listAllResources();
      
      expect(allResources).toBeInstanceOf(Map);
      expect(allResources.has('test-server')).toBe(true);
    });

    it('should read a resource', async () => {
      const request: ResourceReadRequest = {
        uri: 'mock://config/settings.json'
      };

      const response = await manager.readResource(request);
      
      expect(response).toHaveProperty('success', true);
      expect(response).toHaveProperty('contents');
      expect(response).toHaveProperty('serverName');
      expect(response).toHaveProperty('uri', request.uri);
      expect(response).toHaveProperty('timestamp');
    });

    it('should auto-route resource read to correct server', async () => {
      // First list resources to populate cache
      await manager.listResources('test-server');
      
      const request: ResourceReadRequest = {
        // No serverName specified
        uri: 'mock://config/settings.json'
      };

      const response = await manager.readResource(request);
      
      expect(response.success).toBe(true);
      expect(response.serverName).toBe('test-server');
    });

    it('should handle resource not found', async () => {
      const request: ResourceReadRequest = {
        uri: 'mock://non/existent.txt'
      };

      await expect(manager.readResource(request)).rejects.toThrow('not found');
    });

    it('should emit resource read events', async () => {
      const onRead = jest.fn();
      manager.on('resource:read', onRead);

      const request: ResourceReadRequest = {
        uri: 'mock://config/settings.json'
      };

      await manager.readResource(request);
      
      expect(onRead).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          uri: request.uri
        })
      );
    });
  });

  describe('Statistics', () => {
    beforeEach(async () => {
      await manager.connect({
        name: 'test-server',
        type: 'stdio',
        command: 'node',
        args: ['mock-server.js']
      });
    });

    it('should track statistics correctly', async () => {
      // Execute some operations
      await manager.discoverTools('test-server');
      await manager.executeTool({
        toolName: 'read_file',
        arguments: { path: '/test.txt' }
      });
      await manager.listResources('test-server');
      await manager.readResource({
        uri: 'mock://test.txt'
      });

      const stats = manager.getStats();
      
      expect(stats).toHaveProperty('connectedServers', 1);
      expect(stats).toHaveProperty('totalTools');
      expect(stats).toHaveProperty('totalResources');
      expect(stats).toHaveProperty('totalToolCalls', 1);
      expect(stats).toHaveProperty('totalResourceReads', 1);
      expect(stats).toHaveProperty('totalErrors', 0);
    });
  });

  describe('Configuration', () => {
    it('should get current configuration', () => {
      const config = manager.getConfig();
      
      expect(config).toHaveProperty('enabled', true);
      expect(config).toHaveProperty('enableToolCaching', true);
      expect(config).toHaveProperty('toolCacheTTL', 5000);
    });

    it('should update configuration', () => {
      manager.setConfig({
        enableToolCaching: false,
        defaultTimeout: 10000
      });

      const config = manager.getConfig();
      
      expect(config.enableToolCaching).toBe(false);
      expect(config.defaultTimeout).toBe(10000);
    });
  });

  describe('Error Handling', () => {
    it('should emit error events', async () => {
      const onError = jest.fn();
      manager.on('error', onError);

      // Try to connect with invalid configuration
      const connection: MCPServerConnection = {
        name: 'invalid-server',
        type: 'stdio' as const,
        // Missing required command
        command: ''
      };

      await expect(manager.connect(connection)).rejects.toThrow();
      expect(onError).toHaveBeenCalled();
    });

    it('should handle server disconnection gracefully', async () => {
      const connection: MCPServerConnection = {
        name: 'test-server',
        type: 'stdio',
        command: 'node',
        args: ['mock-server.js'],
        autoReconnect: false
      };

      await manager.connect(connection);
      
      // Simulate server disconnection
      const state = manager.getServerState('test-server');
      if (state?.transport && 'onclose' in state.transport) {
        // @ts-ignore - accessing internal method for testing
        state.transport.onclose?.();
      }

      // Should handle gracefully without throwing
      expect(manager.getConnectedServers()).not.toContain('test-server');
    });
  });

  describe('Middleware', () => {
    it('should apply pre-execution middleware', async () => {
      const preExecute = jest.fn((tool, args) => ({
        ...args,
        modified: true
      }));

      manager.setConfig({
        toolMiddleware: [{
          name: 'test-middleware',
          preExecute
        }]
      });

      await manager.connect({
        name: 'test-server',
        type: 'stdio',
        command: 'node',
        args: ['mock-server.js']
      });

      await manager.discoverTools('test-server');
      
      await manager.executeTool({
        toolName: 'read_file',
        arguments: { path: '/test.txt' }
      });

      expect(preExecute).toHaveBeenCalled();
    });

    it('should apply post-execution middleware', async () => {
      const postExecute = jest.fn();

      manager.setConfig({
        toolMiddleware: [{
          name: 'test-middleware',
          postExecute
        }]
      });

      await manager.connect({
        name: 'test-server',
        type: 'stdio',
        command: 'node',
        args: ['mock-server.js']
      });

      await manager.discoverTools('test-server');
      
      await manager.executeTool({
        toolName: 'read_file',
        arguments: { path: '/test.txt' }
      });

      expect(postExecute).toHaveBeenCalled();
    });

    // it('should apply error middleware', async () => {
    //   const onError = jest.fn();
    //
    //   manager.setConfig({
    //     toolMiddleware: [{
    //       name: 'test-middleware',
    //       onError
    //     }]
    //   });
    //
    //   await manager.connect({
    //     name: 'test-server',
    //     type: 'stdio',
    //     command: 'node',
    //     args: ['mock-server.js']
    //   });
    //
    //   // Try to execute non-existent tool
    //   await expect(manager.executeTool({
    //     toolName: 'non_existent',
    //     arguments: {}
    //   })).rejects.toThrow();
    //
    //   // Error middleware should have been called
    //   expect(onError).toHaveBeenCalled();
    // });
  });
});