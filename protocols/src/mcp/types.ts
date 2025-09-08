/**
 * MCP (Model Context Protocol) Type Definitions
 * For integration with Tri-Protocol Framework
 */

import { EventEmitter } from 'events';
import type { 
  CallToolResult,
  ListResourcesResult,
  ReadResourceResult,
  Tool,
  Resource,
  ServerCapabilities
} from '@modelcontextprotocol/sdk/types.js';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { WebSocketClientTransport } from '@modelcontextprotocol/sdk/client/websocket.js';

/**
 * MCP Server Connection Configuration
 */
export interface MCPServerConnection {
  /** Unique name for this server connection */
  name: string;
  
  /** Transport type for the connection */
  type: 'stdio' | 'websocket';
  
  /** Command to execute (for stdio transport) */
  command?: string;
  
  /** Arguments for the command (for stdio transport) */
  args?: string[];
  
  /** WebSocket URL (for websocket transport) */
  url?: string;
  
  /** Environment variables to pass to the server */
  env?: Record<string, string>;
  
  /** Connection timeout in milliseconds */
  timeout?: number;
  
  /** Auto-reconnect on disconnection */
  autoReconnect?: boolean;
  
  /** Maximum number of reconnection attempts */
  maxReconnectAttempts?: number;
  
  /** Delay between reconnection attempts in milliseconds */
  reconnectDelay?: number;
}

/**
 * MCP Tool Description with metadata
 */
export interface MCPToolDescription extends Tool {
  /** Server name that provides this tool */
  serverName: string;
  
  /** Last time this tool was discovered */
  discoveredAt: Date;
  
  /** Number of times this tool has been called */
  callCount?: number;
  
  /** Average execution time in milliseconds */
  avgExecutionTime?: number;
  
  /** Last execution result status */
  lastExecutionStatus?: 'success' | 'failure' | 'timeout';
}

/**
 * MCP Resource with server information
 */
export interface MCPResource extends Resource {
  /** Server name that provides this resource */
  serverName: string;
  
  /** Resource size in bytes (if applicable) */
  size?: number;
  
  /** Last modified timestamp */
  lastModified?: Date;
  
  /** Resource permissions */
  permissions?: {
    read: boolean;
    write: boolean;
    execute: boolean;
  };
}

/**
 * MCP Configuration for an agent
 */
export interface MCPConfig {
  /** Enable MCP functionality for this agent */
  enabled: boolean;
  
  /** List of MCP server connections */
  servers?: MCPServerConnection[];
  
  /** Default timeout for all operations */
  defaultTimeout?: number;
  
  /** Enable tool caching */
  enableToolCaching?: boolean;
  
  /** Tool cache TTL in milliseconds */
  toolCacheTTL?: number;
  
  /** Enable automatic tool discovery on connection */
  autoDiscoverTools?: boolean;
  
  /** Maximum concurrent tool executions */
  maxConcurrentExecutions?: number;
  
  /** Enable detailed logging */
  verboseLogging?: boolean;
  
  /** Custom tool execution middleware */
  toolMiddleware?: ToolMiddleware[];
}

/**
 * Tool execution middleware for pre/post processing
 */
export interface ToolMiddleware {
  /** Middleware name */
  name: string;
  
  /** Pre-execution hook */
  preExecute?: (tool: MCPToolDescription, args: any) => Promise<any>;
  
  /** Post-execution hook */
  postExecute?: (tool: MCPToolDescription, result: any, duration: number) => Promise<void>;
  
  /** Error handling hook */
  onError?: (tool: MCPToolDescription, error: Error) => Promise<void>;
}

/**
 * MCP Client State
 */
export interface MCPClientState {
  /** Current connection status */
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  
  /** Server connection configuration */
  connection: MCPServerConnection;
  
  /** Actual MCP client instance */
  client?: Client;
  
  /** Transport instance */
  transport?: StdioClientTransport | WebSocketClientTransport;
  
  /** Server capabilities */
  capabilities?: ServerCapabilities;
  
  /** Available tools from this server */
  tools: Map<string, MCPToolDescription>;
  
  /** Available resources from this server */
  resources: Map<string, MCPResource>;
  
  /** Connection statistics */
  stats: {
    connectedAt?: Date;
    disconnectedAt?: Date;
    reconnectAttempts: number;
    totalToolCalls: number;
    totalResourceReads: number;
    errors: number;
  };
}

/**
 * Tool execution request
 */
export interface ToolExecutionRequest {
  /** Server name (optional, will auto-route if not specified) */
  serverName?: string;
  
  /** Tool name */
  toolName: string;
  
  /** Tool arguments */
  arguments?: any;
  
  /** Execution timeout override */
  timeout?: number;
  
  /** Request metadata */
  metadata?: Record<string, any>;
}

/**
 * Tool execution response
 */
export interface ToolExecutionResponse {
  /** Execution success status */
  success: boolean;
  
  /** Result data */
  result?: CallToolResult;
  
  /** Error message if failed */
  error?: string;
  
  /** Execution duration in milliseconds */
  duration: number;
  
  /** Server that executed the tool */
  serverName: string;
  
  /** Tool that was executed */
  toolName: string;
  
  /** Execution timestamp */
  timestamp: Date;
}

/**
 * Resource read request
 */
export interface ResourceReadRequest {
  /** Server name (optional, will auto-route if not specified) */
  serverName?: string;
  
  /** Resource URI */
  uri: string;
  
  /** Read timeout override */
  timeout?: number;
}

/**
 * Resource read response  
 */
export interface ResourceReadResponse {
  /** Read success status */
  success: boolean;
  
  /** Resource contents */
  contents?: ReadResourceResult['contents'];
  
  /** Error message if failed */
  error?: string;
  
  /** Server that provided the resource */
  serverName: string;
  
  /** Resource URI */
  uri: string;
  
  /** Read timestamp */
  timestamp: Date;
}

/**
 * MCP Manager Events
 */
export interface MCPManagerEvents {
  /** Emitted when a server is connected */
  'server:connected': (serverName: string, capabilities: ServerCapabilities) => void;
  
  /** Emitted when a server is disconnected */
  'server:disconnected': (serverName: string, reason?: string) => void;
  
  /** Emitted when a server is reconnecting */
  'server:reconnecting': (serverName: string, attempt: number) => void;
  
  /** Emitted when tools are discovered */
  'tools:discovered': (serverName: string, tools: MCPToolDescription[]) => void;
  
  /** Emitted when resources are discovered */
  'resources:discovered': (serverName: string, resources: MCPResource[]) => void;
  
  /** Emitted when a tool is executed */
  'tool:executed': (response: ToolExecutionResponse) => void;
  
  /** Emitted when a resource is read */
  'resource:read': (response: ResourceReadResponse) => void;
  
  /** Emitted on any error */
  'error': (error: Error, context?: any) => void;
}

/**
 * MCP Client Manager Interface
 */
export interface IMCPClientManager extends EventEmitter {
  /** Connect to an MCP server */
  connect(connection: MCPServerConnection): Promise<void>;
  
  /** Disconnect from a server */
  disconnect(serverName: string): Promise<void>;
  
  /** Disconnect from all servers */
  disconnectAll(): Promise<void>;
  
  /** Get all connected servers */
  getConnectedServers(): string[];
  
  /** Get server state */
  getServerState(serverName: string): MCPClientState | undefined;
  
  /** Discover tools from a server */
  discoverTools(serverName: string): Promise<MCPToolDescription[]>;
  
  /** Discover tools from all servers */
  discoverAllTools(): Promise<Map<string, MCPToolDescription[]>>;
  
  /** Get all available tools */
  getAvailableTools(): MCPToolDescription[];
  
  /** Get tools from a specific server */
  getServerTools(serverName: string): MCPToolDescription[];
  
  /** Execute a tool */
  executeTool(request: ToolExecutionRequest): Promise<ToolExecutionResponse>;
  
  /** List resources from a server */
  listResources(serverName: string): Promise<MCPResource[]>;
  
  /** List resources from all servers */
  listAllResources(): Promise<Map<string, MCPResource[]>>;
  
  /** Read a resource */
  readResource(request: ResourceReadRequest): Promise<ResourceReadResponse>;
  
  /** Get manager statistics */
  getStats(): {
    connectedServers: number;
    totalTools: number;
    totalResources: number;
    totalToolCalls: number;
    totalResourceReads: number;
    totalErrors: number;
  };
  
  /** Clear tool cache */
  clearToolCache(): void;
  
  /** Set configuration */
  setConfig(config: Partial<MCPConfig>): void;
  
  /** Get current configuration */
  getConfig(): MCPConfig;
}

/**
 * Agent MCP capabilities interface
 */
export interface AgentMCPCapabilities {
  /** MCP Client Manager instance */
  mcpManager?: IMCPClientManager;
  
  /** Check if MCP is enabled */
  isMCPEnabled(): boolean;
  
  /** Connect to an MCP server */
  connectMCPServer(connection: MCPServerConnection): Promise<void>;
  
  /** Disconnect from an MCP server */
  disconnectMCPServer(serverName: string): Promise<void>;
  
  /** Get available MCP tools */
  getAvailableTools(): MCPToolDescription[];
  
  /** Use an MCP tool */
  useTool(toolName: string, args?: any): Promise<ToolExecutionResponse>;
  
  /** List MCP resources */
  listResources(serverName?: string): Promise<MCPResource[]>;
  
  /** Read an MCP resource */
  readResource(uri: string): Promise<ResourceReadResponse>;
  
  /** Get MCP statistics */
  getMCPStats(): any;
}

/**
 * Protocol adapter message types for MCP
 */
export interface MCPProtocolMessage {
  /** Message type */
  type: 'tool_request' | 'tool_response' | 'resource_request' | 'resource_response' | 'discovery' | 'error';
  
  /** Source agent/server */
  source: string;
  
  /** Target agent/server */
  target?: string;
  
  /** Message payload */
  payload: any;
  
  /** Message metadata */
  metadata?: {
    timestamp: Date;
    correlationId?: string;
    priority?: 'low' | 'normal' | 'high';
    ttl?: number;
  };
}

/**
 * A2A message conversion utilities
 */
export interface MCPMessageConverter {
  /** Convert A2AMessage to MCP format */
  toMCPMessage(a2aMessage: any): MCPProtocolMessage;
  
  /** Convert MCP message to A2AMessage */
  fromMCPMessage(mcpMessage: MCPProtocolMessage): any;
  
  /** Convert tool execution to A2AMessage */
  toolExecutionToA2A(request: ToolExecutionRequest, response: ToolExecutionResponse): any;
  
  /** Convert resource read to A2AMessage */
  resourceReadToA2A(request: ResourceReadRequest, response: ResourceReadResponse): any;
}

export type {
  CallToolResult,
  ListResourcesResult,
  ReadResourceResult,
  Tool,
  Resource,
  ServerCapabilities
} from '@modelcontextprotocol/sdk/types.js';

export type { Client as MCPClient } from '@modelcontextprotocol/sdk/client/index.js';