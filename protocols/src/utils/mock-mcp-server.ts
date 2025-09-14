/**
 * Mock MCP Server for Testing
 * Simulates a basic MCP server with tools and resources for testing purposes
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Logger } from '../../../logger';
import type {
  Tool,
  Resource,
  CallToolResult,
  ReadResourceResult,
  ListResourcesResult,
  ListToolsResult
} from '@modelcontextprotocol/sdk/types.js';

/**
 * Mock MCP Server Configuration
 */
export interface MockMCPServerConfig {
  name: string;
  type: 'stdio' | 'websocket';
  port?: number;
  tools?: MockTool[];
  resources?: MockResource[];
  enableLogging?: boolean;
  simulateLatency?: number;
  simulateErrors?: boolean;
  errorRate?: number;
}

/**
 * Mock Tool Definition
 */
export interface MockTool extends Tool {
  handler?: (args: any) => Promise<any>;
  simulateError?: boolean;
  latency?: number;
}

/**
 * Mock Resource Definition
 */
export interface MockResource extends Resource {
  contents?: any;
  simulateError?: boolean;
  latency?: number;
}

/**
 * Mock MCP Server Implementation
 */
export class MockMCPServer extends EventEmitter {
  private logger: Logger;
  private server?: Server;
  private config: MockMCPServerConfig;
  private tools: Map<string, MockTool> = new Map();
  private resources: Map<string, MockResource> = new Map();
  private callCount: Map<string, number> = new Map();
  private isRunning: boolean = false;

  constructor(config: MockMCPServerConfig) {
    super();
    this.config = config;
    this.logger = Logger.getLogger(`MockMCPServer:${config.name}`);
    
    // Initialize default tools if none provided
    if (!config.tools || config.tools.length === 0) {
      this.initializeDefaultTools();
    } else {
      config.tools.forEach(tool => this.tools.set(tool.name, tool));
    }
    
    // Initialize default resources if none provided
    if (!config.resources || config.resources.length === 0) {
      this.initializeDefaultResources();
    } else {
      config.resources.forEach(resource => this.resources.set(resource.uri, resource));
    }
    
    if (config.enableLogging) {
      this.logger.info('Mock MCP Server initialized', {
        name: config.name,
        tools: this.tools.size,
        resources: this.resources.size
      });
    }
  }

  /**
   * Initialize default mock tools
   */
  private initializeDefaultTools(): void {
    // File system tools
    this.tools.set('read_file', {
      name: 'read_file',
      description: 'Read contents of a file',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path to read' }
        },
        required: ['path']
      },
      handler: async (args: any) => {
        await this.simulateLatency();
        return {
          content: `Mock content of file: ${args.path}`,
          size: 1024,
          lastModified: new Date().toISOString()
        };
      }
    } as MockTool);

    this.tools.set('write_file', {
      name: 'write_file',
      description: 'Write contents to a file',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path to write' },
          content: { type: 'string', description: 'Content to write' }
        },
        required: ['path', 'content']
      },
      handler: async (args: any) => {
        await this.simulateLatency();
        return {
          success: true,
          bytesWritten: args.content?.length || 0,
          path: args.path
        };
      }
    } as MockTool);

    this.tools.set('list_directory', {
      name: 'list_directory',
      description: 'List contents of a directory',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path' }
        },
        required: ['path']
      },
      handler: async (args: any) => {
        await this.simulateLatency();
        return {
          files: [
            { name: 'file1.txt', type: 'file', size: 1024 },
            { name: 'file2.json', type: 'file', size: 2048 },
            { name: 'subdir', type: 'directory', size: 0 }
          ],
          totalCount: 3
        };
      }
    } as MockTool);

    // Data processing tools
    this.tools.set('analyze_data', {
      name: 'analyze_data',
      description: 'Analyze data and return insights',
      inputSchema: {
        type: 'object',
        properties: {
          data: { type: 'any', description: 'Data to analyze' },
          type: { type: 'string', description: 'Type of analysis' }
        },
        required: ['data']
      },
      handler: async (args: any) => {
        await this.simulateLatency();
        return {
          summary: 'Mock analysis complete',
          insights: [
            'Pattern A detected',
            'Trend B observed',
            'Anomaly C found'
          ],
          confidence: 0.85,
          processedAt: new Date().toISOString()
        };
      }
    } as MockTool);

    // System tools
    this.tools.set('get_system_info', {
      name: 'get_system_info',
      description: 'Get system information',
      inputSchema: {
        type: 'object',
        properties: {}
      },
      handler: async () => {
        await this.simulateLatency();
        return {
          os: 'MockOS',
          version: '1.0.0',
          memory: { total: 16384, free: 8192 },
          cpu: { cores: 8, usage: 0.25 },
          timestamp: new Date().toISOString()
        };
      }
    } as MockTool);
  }

  /**
   * Initialize default mock resources
   */
  private initializeDefaultResources(): void {
    this.resources.set('mock://config/settings.json', {
      uri: 'mock://config/settings.json',
      name: 'Settings',
      description: 'Application settings',
      mimeType: 'application/json',
      contents: {
        version: '1.0.0',
        debug: true,
        features: {
          mcp: true,
          a2a: true
        }
      }
    } as MockResource);

    this.resources.set('mock://data/sample.csv', {
      uri: 'mock://data/sample.csv',
      name: 'Sample Data',
      description: 'Sample CSV data',
      mimeType: 'text/csv',
      contents: 'id,name,value\n1,Item1,100\n2,Item2,200\n3,Item3,300'
    } as MockResource);

    this.resources.set('mock://docs/readme.md', {
      uri: 'mock://docs/readme.md',
      name: 'README',
      description: 'Documentation',
      mimeType: 'text/markdown',
      contents: '# Mock MCP Server\n\nThis is a mock MCP server for testing.'
    } as MockResource);
  }

  /**
   * Simulate network latency
   */
  private async simulateLatency(): Promise<void> {
    if (this.config.simulateLatency && this.config.simulateLatency > 0) {
      await new Promise(resolve => setTimeout(resolve, this.config.simulateLatency));
    }
  }

  /**
   * Check if should simulate an error
   */
  private shouldSimulateError(): boolean {
    if (!this.config.simulateErrors) return false;
    const errorRate = this.config.errorRate || 0.1;
    return Math.random() < errorRate;
  }

  /**
   * Start the mock server
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('Mock server is already running');
    }

    try {
      // Create MCP server
      this.server = new Server({
        name: this.config.name,
        version: '1.0.0'
      }, {
        capabilities: {
          tools: {},
          resources: {}
        }
      });

      // Set up handlers
      this.setupHandlers();

      // Create transport based on type
      if (this.config.type === 'stdio') {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
      } else if (this.config.type === 'websocket') {
        const port = this.config.port || 3000;
        // Note: WebSocket server setup would go here
        // For testing, we'll simulate it
        this.logger.info(`Mock WebSocket server would listen on port ${port}`);
      }

      this.isRunning = true;
      this.emit('started');
      
      if (this.config.enableLogging) {
        this.logger.info(`Mock MCP Server '${this.config.name}' started`);
      }

    } catch (error) {
      this.logger.error('Failed to start mock server', error);
      throw error;
    }
  }

  /**
   * Set up request handlers
   */
  private setupHandlers(): void {
    if (!this.server) return;

    // Handle list tools request
    // @ts-ignore - Mock server for testing
    this.server.setRequestHandler('tools/list', async () => {
      await this.simulateLatency();
      
      const tools = Array.from(this.tools.values()).map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema
      }));

      return { tools };
    });

    // Handle call tool request
    // @ts-ignore - Mock server for testing
    this.server.setRequestHandler('tools/call', async (request: any) => {
      const { name, arguments: args } = request.params;
      
      await this.simulateLatency();
      
      // Track call count
      this.callCount.set(name, (this.callCount.get(name) || 0) + 1);
      
      // Check if should simulate error
      if (this.shouldSimulateError()) {
        throw new Error(`Mock error executing tool: ${name}`);
      }
      
      const tool = this.tools.get(name);
      if (!tool) {
        throw new Error(`Tool not found: ${name}`);
      }
      
      // Execute handler if available
      let result: any;
      if (tool.handler) {
        result = await tool.handler(args);
      } else {
        result = {
          success: true,
          mockResult: `Executed ${name} with args: ${JSON.stringify(args)}`,
          timestamp: new Date().toISOString()
        };
      }
      
      this.emit('tool:executed', { name, args, result });
      
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    });

    // Handle list resources request
    // @ts-ignore - Mock server for testing
    this.server.setRequestHandler('resources/list', async () => {
      await this.simulateLatency();
      
      const resources = Array.from(this.resources.values()).map(resource => ({
        uri: resource.uri,
        name: resource.name,
        description: resource.description,
        mimeType: resource.mimeType
      }));

      return { resources };
    });

    // Handle read resource request
    // @ts-ignore - Mock server for testing
    this.server.setRequestHandler('resources/read', async (request: any) => {
      const { uri } = request.params;
      
      await this.simulateLatency();
      
      // Check if should simulate error
      if (this.shouldSimulateError()) {
        throw new Error(`Mock error reading resource: ${uri}`);
      }
      
      const resource = this.resources.get(uri);
      if (!resource) {
        throw new Error(`Resource not found: ${uri}`);
      }
      
      this.emit('resource:read', { uri });
      
      const contents = resource.contents || `Mock contents of ${uri}`;
      
      return {
        contents: [
          {
            uri,
            mimeType: resource.mimeType || 'text/plain',
            text: typeof contents === 'string' ? contents : JSON.stringify(contents, null, 2)
          }
        ]
      };
    });
  }

  /**
   * Stop the mock server
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      if (this.server) {
        await this.server.close();
      }
      
      this.isRunning = false;
      this.emit('stopped');
      
      if (this.config.enableLogging) {
        this.logger.info(`Mock MCP Server '${this.config.name}' stopped`);
      }

    } catch (error) {
      this.logger.error('Error stopping mock server', error);
      throw error;
    }
  }

  /**
   * Add a custom tool
   */
  addTool(tool: MockTool): void {
    this.tools.set(tool.name, tool);
    if (this.config.enableLogging) {
      this.logger.debug(`Added tool: ${tool.name}`);
    }
  }

  /**
   * Add a custom resource
   */
  addResource(resource: MockResource): void {
    this.resources.set(resource.uri, resource);
    if (this.config.enableLogging) {
      this.logger.debug(`Added resource: ${resource.uri}`);
    }
  }

  /**
   * Get call statistics
   */
  getStats(): {
    totalCalls: number;
    callsByTool: Map<string, number>;
    isRunning: boolean;
  } {
    const totalCalls = Array.from(this.callCount.values()).reduce((sum, count) => sum + count, 0);
    
    return {
      totalCalls,
      callsByTool: new Map(this.callCount),
      isRunning: this.isRunning
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.callCount.clear();
  }

  /**
   * Get server info
   */
  getInfo(): {
    name: string;
    type: string;
    toolsCount: number;
    resourcesCount: number;
    isRunning: boolean;
  } {
    return {
      name: this.config.name,
      type: this.config.type,
      toolsCount: this.tools.size,
      resourcesCount: this.resources.size,
      isRunning: this.isRunning
    };
  }
}

/**
 * Create a preconfigured mock server for common test scenarios
 */
export class MockMCPServerFactory {
  /**
   * Create a basic filesystem mock server
   */
  static createFilesystemServer(name: string = 'mock-filesystem'): MockMCPServer {
    return new MockMCPServer({
      name,
      type: 'stdio',
      enableLogging: false,
      simulateLatency: 10
    });
  }

  /**
   * Create a mock database server
   */
  static createDatabaseServer(name: string = 'mock-database'): MockMCPServer {
    const server = new MockMCPServer({
      name,
      type: 'stdio',
      enableLogging: false,
      simulateLatency: 20,
      tools: []
    });

    // Add database-specific tools
    server.addTool({
      name: 'query',
      description: 'Execute a database query',
      inputSchema: {
        type: 'object',
        properties: {
          sql: { type: 'string' }
        },
        required: ['sql']
      },
      handler: async (args: any) => {
        return {
          rows: [
            { id: 1, name: 'Record 1' },
            { id: 2, name: 'Record 2' }
          ],
          rowCount: 2,
          executionTime: 15
        };
      }
    });

    return server;
  }

  /**
   * Create an error-prone server for testing error handling
   */
  static createFaultyServer(name: string = 'mock-faulty'): MockMCPServer {
    return new MockMCPServer({
      name,
      type: 'stdio',
      enableLogging: false,
      simulateErrors: true,
      errorRate: 0.3,
      simulateLatency: 50
    });
  }
}

export default MockMCPServer;