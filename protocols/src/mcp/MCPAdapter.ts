/**
 * MCP Protocol Adapter
 * Bridges MCP functionality with the Tri-Protocol unified messaging system
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { Logger } from '../../../logger';
import { MCPClientManager } from './MCPClientManager';
import type {
    MCPProtocolMessage,
    MCPMessageConverter,
    ToolExecutionRequest,
    ToolExecutionResponse,
    ResourceReadRequest,
    ResourceReadResponse,
    MCPConfig
} from './types';
import type {
    A2AMessage,
    Message
} from '../a2a';
import { A2AMessageType } from '../a2a';

export class MCPAdapter extends EventEmitter implements MCPMessageConverter {
    private logger: Logger;
    private mcpManager: MCPClientManager;
    private isConnected: boolean = false;
    private adapterCapabilities: any;

    constructor(config?: Partial<MCPConfig>) {
        super();
        this.logger = Logger.getLogger('MCPAdapter');
        this.mcpManager = new MCPClientManager(config);
        
        this.adapterCapabilities = {
            supportsBroadcast: false,
            supportsPrivateMessage: true,
            supportsGroupMessage: false,
            supportsEncryption: false,
            supportsCompression: false,
            supportsStreaming: true,
            supportsOfflineMessages: false,
            maxMessageSize: 10 * 1024 * 1024, // 10MB
            supportedFormats: ['json'],
            protocolVersion: '1.0.0'
        };

        this.setupEventHandlers();
        this.logger.info('MCPAdapter initialized');
    }

    /**
     * Setup internal event handlers
     */
    private setupEventHandlers(): void {
        // Forward MCP manager events
        this.mcpManager.on('server:connected', (serverName, capabilities) => {
            this.emit('mcp:server:connected', serverName, capabilities);
        });

        this.mcpManager.on('server:disconnected', (serverName, reason) => {
            this.emit('mcp:server:disconnected', serverName, reason);
        });

        this.mcpManager.on('tool:executed', (response) => {
            // Convert to unified message and emit
            const a2aMessage = this.toolExecutionToA2A(
                { toolName: response.toolName, arguments: response.result },
                response
            );
            this.emit('message:received', a2aMessage);
        });

        this.mcpManager.on('resource:read', (response) => {
            // Convert to unified message and emit
            const a2aMessage = this.resourceReadToA2A(
                { uri: response.uri },
                response
            );
            this.emit('message:received', a2aMessage);
        });

        this.mcpManager.on('error', (error, context) => {
            this.logger.error('MCP error in adapter', error, context);
            this.emit('error', error);
        });
    }

    // === ProtocolAdapter Implementation ===

    /**
     * Get protocol name
     */
    getName(): string {
        return 'mcp';
    }

    /**
     * Get protocol version
     */
    getVersion(): string {
        return '1.0.0';
    }

    /**
     * Get protocol capabilities
     */
    getCapabilities(): any {
        return this.adapterCapabilities;
    }

    /**
     * Connect the adapter
     */
    async connect(): Promise<void> {
        this.isConnected = true;
        this.logger.info('MCPAdapter connected');
        this.emit('connected');
    }

    /**
     * Disconnect the adapter
     */
    async disconnect(): Promise<void> {
        await this.mcpManager.disconnectAll();
        this.isConnected = false;
        this.logger.info('MCPAdapter disconnected');
        this.emit('disconnected');
    }

    /**
     * Check if adapter is connected
     */
    isActive(): boolean {
        return this.isConnected;
    }

    /**
     * Send a message through MCP
     */
    async send(message: A2AMessage, options?: any): Promise<void> {
        if (!this.isConnected) {
            throw new Error('MCPAdapter is not connected');
        }

        try {
            // Convert unified message to MCP protocol message
            const mcpMessage = this.toMCPMessage(message);

            // Route based on message type
            switch (mcpMessage.type) {
                case 'tool_request':
                    await this.handleToolRequest(mcpMessage);
                    break;
                case 'resource_request':
                    await this.handleResourceRequest(mcpMessage);
                    break;
                case 'discovery':
                    await this.handleDiscoveryRequest(mcpMessage);
                    break;
                default:
                    this.logger.warn(`Unsupported MCP message type: ${mcpMessage.type}`);
            }

        } catch (error) {
            this.logger.error('Failed to send MCP message', error);
            throw error;
        }
    }

    /**
     * Receive a message (not typically used for MCP)
     */
    async receive(): Promise<A2AMessage | null> {
        // MCP is primarily push-based through events
        return null;
    }

    /**
     * Subscribe to a topic (not applicable for MCP)
     */
    async subscribe(topic: string): Promise<void> {
        this.logger.debug(`Subscribe called for topic: ${topic} (not applicable for MCP)`);
    }

    /**
     * Unsubscribe from a topic (not applicable for MCP)
     */
    async unsubscribe(topic: string): Promise<void> {
        this.logger.debug(`Unsubscribe called for topic: ${topic} (not applicable for MCP)`);
    }

    // === MCP-specific methods ===

    /**
     * Handle tool execution request
     */
    private async handleToolRequest(message: MCPProtocolMessage): Promise<void> {
        const request = message.payload as ToolExecutionRequest;
        const response = await this.mcpManager.executeTool(request);
        
        // Convert response to unified message and emit
        const a2aMessage = this.toolExecutionToA2A(request, response);
        this.emit('message:received', a2aMessage);
    }

    /**
     * Handle resource read request
     */
    private async handleResourceRequest(message: MCPProtocolMessage): Promise<void> {
        const request = message.payload as ResourceReadRequest;
        const response = await this.mcpManager.readResource(request);
        
        // Convert response to unified message and emit
        const a2aMessage = this.resourceReadToA2A(request, response);
        this.emit('message:received', a2aMessage);
    }

    /**
     * Handle discovery request
     */
    private async handleDiscoveryRequest(message: MCPProtocolMessage): Promise<void> {
        const { target } = message;
        
        if (target === 'tools') {
            const tools = await this.mcpManager.discoverAllTools();
            const a2aMessage: A2AMessage = {
                id: uuidv4(),
                role: 'agent',
                type: A2AMessageType.CAPABILITY_RESPONSE,
                from: 'mcp-adapter',
                to: message.source,
                payload: {
                    type: 'tools_discovery',
                    data: Array.from(tools.entries())
                },
                timestamp: new Date(),
                priority: 'normal'
            };
            this.emit('message:received', a2aMessage);
            
        } else if (target === 'resources') {
            const resources = await this.mcpManager.listAllResources();
            const a2aMessage: A2AMessage = {
                id: uuidv4(),
                role: 'agent',
                type: A2AMessageType.CAPABILITY_RESPONSE,
                from: 'mcp-adapter',
                to: message.source,
                payload: {
                    type: 'resources_discovery',
                    data: Array.from(resources.entries())
                },
                timestamp: new Date(),
                priority: 'normal'
            };
            this.emit('message:received', a2aMessage);
        }
    }

    // === MCPMessageConverter Implementation ===

    /**
     * Convert UnifiedMessage to MCP format
     */
    toMCPMessage(a2aMessage: A2AMessage): MCPProtocolMessage {
        // Determine MCP message type based on A2A message content
        let mcpType: MCPProtocolMessage['type'] = 'tool_request';
        
        if (a2aMessage.payload?.type === 'tool_execution') {
            mcpType = 'tool_request';
        } else if (a2aMessage.payload?.type === 'resource_read') {
            mcpType = 'resource_request';
        } else if (a2aMessage.payload?.type === 'discovery') {
            mcpType = 'discovery';
        } else if (a2aMessage.type === A2AMessageType.CAPABILITY_RESPONSE) {
            if (a2aMessage.payload?.type?.includes('tool')) {
                mcpType = 'tool_response';
            } else if (a2aMessage.payload?.type?.includes('resource')) {
                mcpType = 'resource_response';
            }
        }

        return {
            type: mcpType,
            source: a2aMessage.from,
            target: a2aMessage.to,
            payload: a2aMessage.payload,
            metadata: {
                timestamp: a2aMessage.timestamp,
                correlationId: a2aMessage.correlationId,
                priority: a2aMessage.priority === 'urgent' ? 'high' : (a2aMessage.priority || 'normal'),
                ttl: a2aMessage.ttl
            }
        };
    }

    /**
     * Convert MCP message to UnifiedMessage
     */
    fromMCPMessage(mcpMessage: MCPProtocolMessage): A2AMessage {
        const messageType = mcpMessage.type.includes('response') 
            ? A2AMessageType.CAPABILITY_RESPONSE 
            : A2AMessageType.CAPABILITY_REQUEST;

        return {
            id: uuidv4(),
            role: 'agent',
            type: messageType,
            from: mcpMessage.source,
            to: mcpMessage.target || 'broadcast',
            payload: {
                type: mcpMessage.type,
                data: mcpMessage.payload
            },
            timestamp: mcpMessage.metadata?.timestamp || new Date(),
            priority: mcpMessage.metadata?.priority || 'normal',
            correlationId: mcpMessage.metadata?.correlationId,
            ttl: mcpMessage.metadata?.ttl
        };
    }

    /**
     * Convert tool execution to UnifiedMessage
     */
    toolExecutionToA2A(
        request: ToolExecutionRequest,
        response: ToolExecutionResponse
    ): A2AMessage {
        return {
            id: uuidv4(),
            role: 'agent',
            type: A2AMessageType.TASK_RESPONSE,
            from: `mcp-server:${response.serverName}`,
            to: 'agent',
            payload: {
                type: 'tool_execution_result',
                tool: request.toolName,
                arguments: request.arguments,
                result: response.result,
                success: response.success,
                error: response.error,
                duration: response.duration
            },
            timestamp: response.timestamp,
            priority: 'normal',
            metadata: {
                serverName: response.serverName,
                toolName: response.toolName
            }
        };
    }

    /**
     * Convert resource read to UnifiedMessage
     */
    resourceReadToA2A(
        request: ResourceReadRequest,
        response: ResourceReadResponse
    ): A2AMessage {
        return {
            id: uuidv4(),
            role: 'agent',
            type: A2AMessageType.TASK_RESPONSE,
            from: `mcp-server:${response.serverName}`,
            to: 'agent',
            payload: {
                type: 'resource_read_result',
                uri: request.uri,
                contents: response.contents,
                success: response.success,
                error: response.error
            },
            timestamp: response.timestamp,
            priority: 'normal',
            metadata: {
                serverName: response.serverName,
                resourceUri: response.uri
            }
        };
    }

    // === Public MCP Manager Access ===

    /**
     * Get the underlying MCP client manager
     */
    getMCPManager(): MCPClientManager {
        return this.mcpManager;
    }

    /**
     * Connect to an MCP server through the adapter
     */
    async connectMCPServer(connection: any): Promise<void> {
        await this.mcpManager.connect(connection);
    }

    /**
     * Disconnect from an MCP server
     */
    async disconnectMCPServer(serverName: string): Promise<void> {
        await this.mcpManager.disconnect(serverName);
    }

    /**
     * Get available tools
     */
    getAvailableTools() {
        return this.mcpManager.getAvailableTools();
    }

    /**
     * Execute a tool directly
     */
    async executeTool(request: ToolExecutionRequest): Promise<ToolExecutionResponse> {
        return this.mcpManager.executeTool(request);
    }

    /**
     * List resources
     */
    async listResources(serverName?: string) {
        if (serverName) {
            return this.mcpManager.listResources(serverName);
        }
        return this.mcpManager.listAllResources();
    }

    /**
     * Read a resource
     */
    async readResource(request: ResourceReadRequest): Promise<ResourceReadResponse> {
        return this.mcpManager.readResource(request);
    }

    /**
     * Get adapter statistics
     */
    getStats() {
        return {
            ...this.mcpManager.getStats(),
            adapterConnected: this.isConnected
        };
    }
}