/**
 * MCP Client Manager
 * Manages multiple MCP server connections for agents in the Tri-Protocol Framework
 */

import { EventEmitter } from 'events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { WebSocketClientTransport } from '@modelcontextprotocol/sdk/client/websocket.js';
import { Logger } from '../../../logger';
import { MCPCircuitBreaker, CircuitBreakerConfig } from './MCPCircuitBreaker';
import type {
  MCPServerConnection,
  MCPClientState,
  MCPToolDescription,
  MCPResource,
  MCPConfig,
  IMCPClientManager,
  ToolExecutionRequest,
  ToolExecutionResponse,
  ResourceReadRequest,
  ResourceReadResponse,
  MCPManagerEvents,
  ToolMiddleware
} from './types';

export class MCPClientManager extends EventEmitter implements IMCPClientManager {
  private logger: Logger;
  private servers: Map<string, MCPClientState> = new Map();
  private config: MCPConfig;
  private toolCache: Map<string, { tools: MCPToolDescription[], timestamp: number }> = new Map();
  private executionQueue: Map<string, Promise<any>> = new Map();
  private activeExecutions = 0;
  private circuitBreaker: MCPCircuitBreaker;

  constructor(config: Partial<MCPConfig> = {}) {
    super();
    this.logger = Logger.getLogger('MCPClientManager');
    this.config = this.mergeConfig(config);
    this.circuitBreaker = new MCPCircuitBreaker();
    this.setupCircuitBreakerListeners();
    this.logger.info('MCPClientManager initialized', { config: this.config });
  }

  private mergeConfig(partial: Partial<MCPConfig>): MCPConfig {
    return {
      enabled: true,
      servers: [],
      defaultTimeout: 30000,
      enableToolCaching: true,
      toolCacheTTL: 300000, // 5 minutes
      autoDiscoverTools: true,
      maxConcurrentExecutions: 10,
      verboseLogging: false,
      toolMiddleware: [],
      circuitBreaker: {
        enabled: true,
        failureThreshold: 5,
        successThreshold: 2,
        timeout: 60000,
        monitoringPeriod: 120000,
        resetTimeout: 300000,
        ...partial.circuitBreaker
      },
      ...partial
    };
  }

  /**
   * Connect to an MCP server
   */
  async connect(connection: MCPServerConnection): Promise<void> {
    this.logger.info(`Connecting to MCP server: ${connection.name}`, { type: connection.type });

    if (this.servers.has(connection.name)) {
      throw new Error(`Server ${connection.name} is already connected`);
    }

    const state: MCPClientState = {
      status: 'connecting',
      connection,
      tools: new Map(),
      resources: new Map(),
      stats: {
        reconnectAttempts: 0,
        totalToolCalls: 0,
        totalResourceReads: 0,
        errors: 0
      }
    };

    this.servers.set(connection.name, state);

    try {
      // Create transport based on type
      let transport: StdioClientTransport | WebSocketClientTransport;
      
      if (connection.type === 'stdio') {
        if (!connection.command) {
          throw new Error('Command is required for stdio transport');
        }
        
        transport = new StdioClientTransport({
          command: connection.command,
          args: connection.args || [],
          env: connection.env
        });
        state.transport = transport;
      } else if (connection.type === 'websocket') {
        if (!connection.url) {
          throw new Error('URL is required for websocket transport');
        }
        
        transport = new WebSocketClientTransport(new URL(connection.url));
        state.transport = transport;
      } else {
        throw new Error(`Unsupported transport type: ${connection.type}`);
      }

      // Create MCP client
      const client = new Client({
        name: `tri-protocol-agent-${connection.name}`,
        version: '1.0.0'
      }, {
        capabilities: {}
      });
      
      state.client = client;

      // Connect to server
      await client.connect(transport);
      
      // Get server capabilities
      // Note: getServerInfo might not exist in all MCP client versions
      // For now, we'll set basic capabilities
      state.capabilities = {
        tools: {},
        resources: {}
      };
      
      state.status = 'connected';
      state.stats.connectedAt = new Date();

      // Initialize circuit breaker for this server if enabled
      if (this.config.circuitBreaker?.enabled) {
        this.circuitBreaker.initializeCircuit(connection.name, {
          failureThreshold: this.config.circuitBreaker.failureThreshold,
          successThreshold: this.config.circuitBreaker.successThreshold,
          timeout: this.config.circuitBreaker.timeout,
          monitoringPeriod: this.config.circuitBreaker.monitoringPeriod,
          resetTimeout: this.config.circuitBreaker.resetTimeout
        });
      }

      this.logger.info(`Connected to MCP server: ${connection.name}`, { 
        capabilities: state.capabilities 
      });

      // Emit connection event
      this.emit('server:connected', connection.name, state.capabilities!);

      // Auto-discover tools if enabled
      if (this.config.autoDiscoverTools) {
        await this.discoverTools(connection.name);
      }

      // Setup auto-reconnect if enabled
      if (connection.autoReconnect) {
        this.setupAutoReconnect(connection.name);
      }

    } catch (error) {
      state.status = 'error';
      state.stats.errors++;
      this.servers.delete(connection.name);
      
      this.logger.error(`Failed to connect to MCP server: ${connection.name}`, error);
      this.emit('error', error as Error, { serverName: connection.name });
      
      throw error;
    }
  }

  /**
   * Setup auto-reconnect for a server
   */
  private setupAutoReconnect(serverName: string): void {
    const state = this.servers.get(serverName);
    if (!state) return;

    const { connection } = state;
    if (!connection.autoReconnect) return;

    // Monitor transport for disconnection
    if (state.transport) {
      state.transport.onclose = async () => {
        this.logger.warn(`Server ${serverName} disconnected, attempting reconnect...`);
        state.status = 'disconnected';
        state.stats.disconnectedAt = new Date();
        this.emit('server:disconnected', serverName, 'transport_closed');

        await this.attemptReconnect(serverName);
      };

      state.transport.onerror = (error: Error) => {
        this.logger.error(`Transport error for server ${serverName}`, error);
        state.stats.errors++;
        this.emit('error', error, { serverName });
      };
    }
  }

  /**
   * Attempt to reconnect to a server
   */
  private async attemptReconnect(serverName: string): Promise<void> {
    const state = this.servers.get(serverName);
    if (!state) return;

    const { connection } = state;
    const maxAttempts = connection.maxReconnectAttempts || 5;
    const delay = connection.reconnectDelay || 5000;

    while (state.stats.reconnectAttempts < maxAttempts) {
      state.stats.reconnectAttempts++;
      this.emit('server:reconnecting', serverName, state.stats.reconnectAttempts);

      try {
        // Remove old state
        this.servers.delete(serverName);
        
        // Attempt reconnection
        await this.connect(connection);
        
        this.logger.info(`Successfully reconnected to server ${serverName}`);
        return;
      } catch (error) {
        this.logger.warn(`Reconnect attempt ${state.stats.reconnectAttempts} failed for ${serverName}`);
        
        if (state.stats.reconnectAttempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    this.logger.error(`Failed to reconnect to server ${serverName} after ${maxAttempts} attempts`);
    this.servers.delete(serverName);
  }

  /**
   * Disconnect from a server
   */
  async disconnect(serverName: string): Promise<void> {
    const state = this.servers.get(serverName);
    if (!state) {
      throw new Error(`Server ${serverName} is not connected`);
    }

    try {
      if (state.client) {
        await state.client.close();
      }

      state.status = 'disconnected';
      state.stats.disconnectedAt = new Date();
      this.servers.delete(serverName);

      // Remove circuit breaker for this server
      if (this.config.circuitBreaker?.enabled) {
        this.circuitBreaker.removeCircuit(serverName);
      }

      this.logger.info(`Disconnected from MCP server: ${serverName}`);
      this.emit('server:disconnected', serverName, 'manual_disconnect');

    } catch (error) {
      this.logger.error(`Error disconnecting from server ${serverName}`, error);
      throw error;
    }
  }

  /**
   * Disconnect from all servers
   */
  async disconnectAll(): Promise<void> {
    const disconnectPromises = Array.from(this.servers.keys()).map(serverName => 
      this.disconnect(serverName).catch(error => 
        this.logger.error(`Error disconnecting from ${serverName}`, error)
      )
    );

    await Promise.all(disconnectPromises);
    this.logger.info('Disconnected from all MCP servers');
  }

  /**
   * Get all connected servers
   */
  getConnectedServers(): string[] {
    return Array.from(this.servers.entries())
      .filter(([_, state]) => state.status === 'connected')
      .map(([name, _]) => name);
  }

  /**
   * Get server state
   */
  getServerState(serverName: string): MCPClientState | undefined {
    return this.servers.get(serverName);
  }

  /**
   * Discover tools from a server
   */
  async discoverTools(serverName: string): Promise<MCPToolDescription[]> {
    const state = this.servers.get(serverName);
    if (!state || state.status !== 'connected') {
      throw new Error(`Server ${serverName} is not connected`);
    }

    try {
      // Check cache first
      if (this.config.enableToolCaching) {
        const cached = this.toolCache.get(serverName);
        if (cached && Date.now() - cached.timestamp < this.config.toolCacheTTL!) {
          this.logger.debug(`Using cached tools for server ${serverName}`);
          return cached.tools;
        }
      }

      // Fetch tools from server
      const toolsResponse = await state.client!.listTools();
      const tools: MCPToolDescription[] = toolsResponse.tools.map((tool: any) => ({
        ...tool,
        serverName,
        discoveredAt: new Date(),
        callCount: 0
      }));

      // Update state
      state.tools.clear();
      tools.forEach(tool => {
        state.tools.set(tool.name, tool);
      });

      // Update cache
      if (this.config.enableToolCaching) {
        this.toolCache.set(serverName, {
          tools,
          timestamp: Date.now()
        });
      }

      this.logger.info(`Discovered ${tools.length} tools from server ${serverName}`);
      this.emit('tools:discovered', serverName, tools);

      return tools;

    } catch (error) {
      this.logger.error(`Failed to discover tools from server ${serverName}`, error);
      state.stats.errors++;
      throw error;
    }
  }

  /**
   * Discover tools from all servers
   */
  async discoverAllTools(): Promise<Map<string, MCPToolDescription[]>> {
    const results = new Map<string, MCPToolDescription[]>();
    
    const discoverPromises = this.getConnectedServers().map(async serverName => {
      try {
        const tools = await this.discoverTools(serverName);
        results.set(serverName, tools);
      } catch (error) {
        this.logger.error(`Failed to discover tools from ${serverName}`, error);
        results.set(serverName, []);
      }
    });

    await Promise.all(discoverPromises);
    return results;
  }

  /**
   * Get all available tools
   */
  getAvailableTools(): MCPToolDescription[] {
    const allTools: MCPToolDescription[] = [];
    
    this.servers.forEach((state, serverName) => {
      if (state.status === 'connected') {
        state.tools.forEach(tool => allTools.push(tool));
      }
    });

    return allTools;
  }

  /**
   * Get tools from a specific server
   */
  getServerTools(serverName: string): MCPToolDescription[] {
    const state = this.servers.get(serverName);
    if (!state) {
      return [];
    }

    return Array.from(state.tools.values());
  }

  /**
   * Execute a tool
   */
  async executeTool(request: ToolExecutionRequest): Promise<ToolExecutionResponse> {
    const startTime = Date.now();
    let targetServer: string | undefined;
    
    // Check concurrent execution limit
    if (this.activeExecutions >= this.config.maxConcurrentExecutions!) {
      throw new Error('Maximum concurrent executions reached');
    }

    this.activeExecutions++;

    try {
      // Find the server that has this tool
      targetServer = request.serverName;
      let tool: MCPToolDescription | undefined;

      if (!targetServer) {
        // Auto-route to the first server that has this tool
        for (const [serverName, state] of this.servers) {
          if (state.status === 'connected' && state.tools.has(request.toolName)) {
            targetServer = serverName;
            tool = state.tools.get(request.toolName);
            break;
          }
        }
      } else {
        const state = this.servers.get(targetServer);
        if (state && state.status === 'connected') {
          tool = state.tools.get(request.toolName);
        }
      }

      if (!targetServer || !tool) {
        throw new Error(`Tool ${request.toolName} not found`);
      }

      // Check circuit breaker if enabled
      if (this.config.circuitBreaker?.enabled) {
        if (!this.circuitBreaker.shouldAllowRequest(targetServer)) {
          const circuitState = this.circuitBreaker.getCircuitState(targetServer);
          throw new Error(`Circuit breaker is ${circuitState?.status} for server ${targetServer}`);
        }
      }

      const state = this.servers.get(targetServer)!;

      // Apply pre-execution middleware
      let processedArgs = request.arguments;
      for (const middleware of this.config.toolMiddleware || []) {
        if (middleware.preExecute) {
          processedArgs = await middleware.preExecute(tool, processedArgs);
        }
      }

      // Execute the tool
      const timeout = request.timeout || this.config.defaultTimeout!;
      const result = await Promise.race([
        state.client!.callTool({
          name: request.toolName,
          arguments: processedArgs
        }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Tool execution timeout')), timeout)
        )
      ]);

      // Update statistics
      const duration = Date.now() - startTime;
      tool.callCount = (tool.callCount || 0) + 1;
      tool.avgExecutionTime = tool.avgExecutionTime 
        ? (tool.avgExecutionTime + duration) / 2 
        : duration;
      tool.lastExecutionStatus = 'success';
      state.stats.totalToolCalls++;

      // Record success in circuit breaker
      if (this.config.circuitBreaker?.enabled) {
        this.circuitBreaker.recordSuccess(targetServer);
      }

      const response: ToolExecutionResponse = {
        success: true,
        result: result as any,
        duration,
        serverName: targetServer,
        toolName: request.toolName,
        timestamp: new Date()
      };

      // Apply post-execution middleware
      for (const middleware of this.config.toolMiddleware || []) {
        if (middleware.postExecute) {
          await middleware.postExecute(tool, result, duration);
        }
      }

      this.logger.info(`Tool executed successfully: ${request.toolName}`, {
        serverName: targetServer,
        duration
      });

      this.emit('tool:executed', response);
      return response;

    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Update error statistics
      const serverName = request.serverName || targetServer;
      if (serverName) {
        const state = this.servers.get(serverName);
        if (state) {
          state.stats.errors++;
          const tool = state.tools.get(request.toolName);
          if (tool) {
            tool.lastExecutionStatus = 'failure';
          }
        }

        // Record failure in circuit breaker
        if (this.config.circuitBreaker?.enabled && error instanceof Error) {
          this.circuitBreaker.recordFailure(serverName, error);
        }
      }

      // Apply error middleware
      let toolForError: MCPToolDescription | undefined;
      if (request.serverName) {
        const state = this.servers.get(request.serverName);
        if (state) {
          toolForError = state.tools.get(request.toolName);
        }
      }
      
      for (const middleware of this.config.toolMiddleware || []) {
        if (middleware.onError) {
          // Only call onError if we have a tool description
          // For non-existent tools, create a minimal description
          const toolDesc = toolForError || ({
            name: request.toolName,
            description: 'Unknown tool',
            inputSchema: {},
            serverName: request.serverName || targetServer || 'unknown',
            discoveredAt: new Date()
          } as unknown as MCPToolDescription);
          await middleware.onError(toolDesc, error as Error);
        }
      }

      const response: ToolExecutionResponse = {
        success: false,
        error: errorMessage,
        duration,
        serverName: request.serverName || 'unknown',
        toolName: request.toolName,
        timestamp: new Date()
      };

      this.logger.error(`Tool execution failed: ${request.toolName}`, error);
      this.emit('tool:executed', response);
      
      throw error;

    } finally {
      this.activeExecutions--;
    }
  }

  /**
   * List resources from a server
   */
  async listResources(serverName: string): Promise<MCPResource[]> {
    const state = this.servers.get(serverName);
    if (!state || state.status !== 'connected') {
      throw new Error(`Server ${serverName} is not connected`);
    }

    try {
      const resourcesResponse = await state.client!.listResources();
      const resources: MCPResource[] = resourcesResponse.resources.map((resource: any) => ({
        ...resource,
        serverName
      }));

      // Update state
      state.resources.clear();
      resources.forEach(resource => {
        state.resources.set(resource.uri, resource);
      });

      this.logger.info(`Listed ${resources.length} resources from server ${serverName}`);
      this.emit('resources:discovered', serverName, resources);

      return resources;

    } catch (error) {
      this.logger.error(`Failed to list resources from server ${serverName}`, error);
      state.stats.errors++;
      throw error;
    }
  }

  /**
   * List resources from all servers
   */
  async listAllResources(): Promise<Map<string, MCPResource[]>> {
    const results = new Map<string, MCPResource[]>();
    
    const listPromises = this.getConnectedServers().map(async serverName => {
      try {
        const resources = await this.listResources(serverName);
        results.set(serverName, resources);
      } catch (error) {
        this.logger.error(`Failed to list resources from ${serverName}`, error);
        results.set(serverName, []);
      }
    });

    await Promise.all(listPromises);
    return results;
  }

  /**
   * Read a resource
   */
  async readResource(request: ResourceReadRequest): Promise<ResourceReadResponse> {
    try {
      // Find the server that has this resource
      let targetServer: string | undefined = request.serverName;
      
      if (!targetServer) {
        // Auto-route to the first server that has this resource
        for (const [serverName, state] of this.servers) {
          if (state.status === 'connected' && state.resources.has(request.uri)) {
            targetServer = serverName;
            break;
          }
        }
        
        // If not found in cache, try each connected server
        if (!targetServer) {
          for (const serverName of this.getConnectedServers()) {
            await this.listResources(serverName);
            const state = this.servers.get(serverName)!;
            if (state.resources.has(request.uri)) {
              targetServer = serverName;
              break;
            }
          }
        }
      }

      if (!targetServer) {
        throw new Error(`Resource ${request.uri} not found`);
      }

      const state = this.servers.get(targetServer)!;
      
      // Read the resource
      const timeout = request.timeout || this.config.defaultTimeout!;
      const result = await Promise.race([
        state.client!.readResource({ uri: request.uri }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Resource read timeout')), timeout)
        )
      ]);

      state.stats.totalResourceReads++;

      const response: ResourceReadResponse = {
        success: true,
        contents: (result as any).contents,
        serverName: targetServer,
        uri: request.uri,
        timestamp: new Date()
      };

      this.logger.info(`Resource read successfully: ${request.uri}`, {
        serverName: targetServer
      });

      this.emit('resource:read', response);
      return response;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      const response: ResourceReadResponse = {
        success: false,
        error: errorMessage,
        serverName: request.serverName || 'unknown',
        uri: request.uri,
        timestamp: new Date()
      };

      this.logger.error(`Resource read failed: ${request.uri}`, error);
      this.emit('resource:read', response);
      
      throw error;
    }
  }

  /**
   * Get manager statistics
   */
  getStats(): {
    connectedServers: number;
    totalTools: number;
    totalResources: number;
    totalToolCalls: number;
    totalResourceReads: number;
    totalErrors: number;
  } {
    let totalTools = 0;
    let totalResources = 0;
    let totalToolCalls = 0;
    let totalResourceReads = 0;
    let totalErrors = 0;

    this.servers.forEach(state => {
      if (state.status === 'connected') {
        totalTools += state.tools.size;
        totalResources += state.resources.size;
        totalToolCalls += state.stats.totalToolCalls;
        totalResourceReads += state.stats.totalResourceReads;
        totalErrors += state.stats.errors;
      }
    });

    return {
      connectedServers: this.getConnectedServers().length,
      totalTools,
      totalResources,
      totalToolCalls,
      totalResourceReads,
      totalErrors
    };
  }

  /**
   * Clear tool cache
   */
  clearToolCache(): void {
    this.toolCache.clear();
    this.logger.info('Tool cache cleared');
  }

  /**
   * Set configuration
   */
  setConfig(config: Partial<MCPConfig>): void {
    this.config = this.mergeConfig(config);
    this.logger.info('Configuration updated', { config: this.config });
  }

  /**
   * Get current configuration
   */
  getConfig(): MCPConfig {
    return { ...this.config };
  }

  /**
   * Setup circuit breaker event listeners
   */
  private setupCircuitBreakerListeners(): void {
    this.circuitBreaker.on('circuit:open', (serverName, reason) => {
      this.logger.warn(`Circuit opened for server ${serverName}: ${reason}`);
      this.emit('server:circuit:open', serverName, reason);
    });

    this.circuitBreaker.on('circuit:close', (serverName) => {
      this.logger.info(`Circuit closed for server ${serverName}`);
      this.emit('server:circuit:close', serverName);
    });

    this.circuitBreaker.on('circuit:half-open', (serverName) => {
      this.logger.info(`Circuit half-open for server ${serverName}`);
      this.emit('server:circuit:half-open', serverName);
    });
  }

  /**
   * Get circuit breaker state for a server
   */
  getCircuitState(serverName: string): any {
    return this.circuitBreaker.getCircuitState(serverName);
  }

  /**
   * Get circuit breaker statistics
   */
  getCircuitStatistics(serverName: string): any {
    return this.circuitBreaker.getStatistics(serverName);
  }

  /**
   * Reset circuit breaker for a server
   */
  resetCircuitBreaker(serverName: string): void {
    this.circuitBreaker.resetCircuit(serverName);
    this.logger.info(`Circuit breaker reset for server ${serverName}`);
  }

  /**
   * Declare event emitter types
   */
  on<K extends keyof MCPManagerEvents>(event: K, listener: MCPManagerEvents[K]): this {
    return super.on(event, listener as any);
  }

  emit<K extends keyof MCPManagerEvents>(
    event: K,
    ...args: Parameters<MCPManagerEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }
}