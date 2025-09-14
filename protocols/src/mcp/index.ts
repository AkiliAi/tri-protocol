/**
 * MCP Protocol Module Exports
 */

export { MCPClientManager } from './MCPClientManager';
export { MCPAdapter } from './MCPAdapter';
export { MCPCircuitBreaker } from './MCPCircuitBreaker';
export type { CircuitBreakerConfig, CircuitBreakerState, CircuitBreakerEvents } from './MCPCircuitBreaker';

export type {
    // Server connections
    MCPServerConnection,
    MCPClientState,
    
    // Tools and resources
    MCPToolDescription,
    MCPResource,
    
    // Configuration
    MCPConfig,
    ToolMiddleware,
    
    // Requests and responses
    ToolExecutionRequest,
    ToolExecutionResponse,
    ResourceReadRequest,
    ResourceReadResponse,
    
    // Protocol messages
    MCPProtocolMessage,
    MCPMessageConverter,
    
    // Events
    MCPManagerEvents,
    
    // Interfaces
    IMCPClientManager,
    AgentMCPCapabilities,
    
    // Re-export MCP SDK types
    MCPClient,
    CallToolResult,
    ListResourcesResult,
    ReadResourceResult,
    Tool,
    Resource,
    ServerCapabilities
} from './types';