/**
 * TriProtocol Agent
 * TriAgent is the base class for all agents in the Tri Protocol ecosystem.
 * this class provides the core functionality for connecting to the Tri Protocol,
 */

// core/src/TriAgent.ts
import { EventEmitter } from 'eventemitter3';
import { TriProtocol } from './TriProtocol';
import {
    AgentProfile,
    AgentCapability,
    AgentStatus,
    Message,
    Task,
    AgentSystemFeatures,
    A2AMessage,
    A2AMessageType
} from '@protocols/a2a/types';
import { v4 as uuidv4 } from 'uuid';
import { Logger } from '../../logger';
import { MCPClientManager } from '@protocols/mcp';
import type {
    MCPConfig,
    MCPServerConnection,
    MCPToolDescription,
    MCPResource,
    ToolExecutionResponse,
    ResourceReadResponse,
    AgentMCPCapabilities
} from '@protocols/mcp';

export interface TriAgentConfig {
    id: string;
    name: string;
    type: string;
    description: string;
    capabilities: AgentCapability[];
    systemFeatures?: AgentSystemFeatures;
    metadata?: Record<string, any>;
    enableMCP?: boolean;
    mcpConfig?: Partial<MCPConfig>;
}

export abstract class TriAgent extends EventEmitter implements AgentMCPCapabilities {
    protected config: TriAgentConfig;
    protected triProtocol?: TriProtocol;
    protected status: AgentStatus = AgentStatus.OFFLINE;
    protected profile?: AgentProfile;
    protected logger: Logger;
    public mcpManager?: MCPClientManager;

    constructor(config: TriAgentConfig) {
        super();
        this.config = config;
        this.logger = Logger.getLogger(`TriAgent:${config.name}`);
        
        // Initialize MCP if enabled
        if (config.enableMCP) {
            this.mcpManager = new MCPClientManager(config.mcpConfig || {});
            this.setupMCPEventHandlers();
            this.logger.info('MCP support enabled for agent', { agentId: config.id });
        }
    }

    async connect(triProtocol: TriProtocol): Promise<void> {
        this.triProtocol = triProtocol;

        // Build agent profile
        this.profile = {
            agentId: this.config.id,
            agentType: this.config.type,
            status: AgentStatus.ONLINE,
            capabilities: this.config.capabilities,
            systemFeatures: this.config.systemFeatures || {
                streaming: false,
                pushNotifications: false
            },
            metadata: {
                version: '1.0.0',
                location: `agent://${this.config.id}`,
                load: 0,
                uptime: Date.now(),
                capabilities_count: this.config.capabilities.length,
                ...this.config.metadata,
                registeredAt: new Date(),
                lastUpdated: new Date()
            },
            lastSeen: new Date()
        };

        // Register with Tri-Protocol
        if (this.profile) {
            await triProtocol.registerAgent(this.profile);
        }
        this.status = AgentStatus.ONLINE;

        // Setup event handlers
        this.setupEventHandlers();

        console.log(`✅ Agent ${this.config.name} connected to Tri-Protocol`);
        this.emit('connected', this.profile);
    }

    async disconnect(): Promise<void> {
        if (this.triProtocol && this.profile) {
            await this.triProtocol.unregisterAgent(this.config.id);
        }

        // Disconnect all MCP servers if enabled
        if (this.mcpManager) {
            await this.mcpManager.disconnectAll();
        }

        this.status = AgentStatus.OFFLINE;
        this.removeAllListeners();

        console.log(`🛑 Agent ${this.config.name} disconnected`);
        this.emit('disconnected');
    }

    private setupEventHandlers(): void {
        if (!this.triProtocol) return;

        // Listen for messages targeted to this agent
        this.triProtocol.on('tri:a2a:message:received', async (message: A2AMessage) => {
            if (message.to === this.config.id) {
                await this.handleIncomingMessage(message);
            }
        });
    }

    private async handleIncomingMessage(a2aMessage: A2AMessage): Promise<void> {
        try {
            // Convert A2A message to standard Message
            const message: Message = a2aMessage.payload as Message;

            // Process the message
            const response = await this.processMessage(message);

            // Send response back
            if (response) {
                await this.sendToAgent(a2aMessage.from, response);
            }
        } catch (error) {
            this.emit('error', error);
        }
    }

    // === Abstract Methods to Implement ===

    abstract processMessage(message: Message): Promise<Message | Task>;
    abstract processTask(task: Task): Promise<void>;
    
    /**
     * Optional: Override to implement custom tool selection logic
     * @param tools Available tools
     * @param context Current context
     * @returns Selected tool name or null
     */
    protected selectTool?(tools: MCPToolDescription[], context?: any): string | null;

    // === Helper Methods ===

    protected async sendToAgent(targetAgentId: string, content: any): Promise<any> {
        if (!this.triProtocol) {
            throw new Error('Agent not connected to TriProtocol');
        }

        const message: Message = {
            role: 'agent',
            parts: [{
                kind: 'data',
                data: content
            }],
            messageId: uuidv4(),
            kind: 'message'
        };

        return this.triProtocol.sendMessage(targetAgentId, message);
    }

    protected async broadcast(content: any): Promise<void> {
        if (!this.triProtocol) {
            throw new Error('Agent not connected to TriProtocol');
        }

        const a2aMessage: A2AMessage = {
            id: uuidv4(),
            role: 'agent',
            from: this.config.id,
            to: 'broadcast',
            type: A2AMessageType.NETWORK_BROADCAST,
            payload: content,
            timestamp: new Date(),
            priority: 'normal'
        };

        await this.triProtocol.routeMessage(a2aMessage);
    }

    protected async discoverAgents(capability?: string): Promise<AgentProfile[]> {
        if (!this.triProtocol) {
            throw new Error('Agent not connected to TriProtocol');
        }

        if (capability) {
            return this.triProtocol.findAgentsByCapability(capability);
        }

        // Get all agents via status
        const status = this.triProtocol.getStatus();
        return []; // TODO: Implement getRegisteredAgents in TriProtocol
    }

    protected updateLoad(load: number): void {
        if (this.profile) {
            this.profile.metadata.load = Math.max(0, Math.min(100, load));
            this.emit('load:updated', load);
        }
    }

    protected updateStatus(status: AgentStatus): void {
        this.status = status;
        if (this.profile) {
            this.profile.status = status;
            this.emit('status:changed', status);
        }
    }

    getProfile(): AgentProfile | undefined {
        return this.profile;
    }

    getStatus(): AgentStatus {
        return this.status;
    }

    // === MCP Methods ===

    /**
     * Setup MCP event handlers
     */
    private setupMCPEventHandlers(): void {
        if (!this.mcpManager) return;

        this.mcpManager.on('server:connected', (serverName, capabilities) => {
            this.logger.info(`MCP server connected: ${serverName}`, { capabilities });
            this.emit('mcp:server:connected', serverName, capabilities);
        });

        this.mcpManager.on('server:disconnected', (serverName, reason) => {
            this.logger.warn(`MCP server disconnected: ${serverName}`, { reason });
            this.emit('mcp:server:disconnected', serverName, reason);
        });

        this.mcpManager.on('tool:executed', (response) => {
            this.logger.debug(`MCP tool executed: ${response.toolName}`, {
                success: response.success,
                duration: response.duration
            });
            this.emit('mcp:tool:executed', response);
        });

        this.mcpManager.on('error', (error, context) => {
            this.logger.error('MCP error', error, context);
            this.emit('mcp:error', error, context);
        });
    }

    /**
     * Check if MCP is enabled for this agent
     */
    isMCPEnabled(): boolean {
        return this.config.enableMCP === true && this.mcpManager !== undefined;
    }

    /**
     * Connect to an MCP server
     */
    async connectMCPServer(connection: MCPServerConnection): Promise<void> {
        if (!this.mcpManager) {
            throw new Error('MCP is not enabled for this agent');
        }
        
        await this.mcpManager.connect(connection);
        this.logger.info(`Connected to MCP server: ${connection.name}`);
    }

    /**
     * Disconnect from an MCP server
     */
    async disconnectMCPServer(serverName: string): Promise<void> {
        if (!this.mcpManager) {
            throw new Error('MCP is not enabled for this agent');
        }
        
        await this.mcpManager.disconnect(serverName);
        this.logger.info(`Disconnected from MCP server: ${serverName}`);
    }

    /**
     * Get available MCP tools
     */
    getAvailableTools(): MCPToolDescription[] {
        if (!this.mcpManager) {
            return [];
        }
        
        return this.mcpManager.getAvailableTools();
    }

    /**
     * Use an MCP tool
     */
    async useTool(toolName: string, args?: any): Promise<ToolExecutionResponse> {
        if (!this.mcpManager) {
            throw new Error('MCP is not enabled for this agent');
        }
        
        const response = await this.mcpManager.executeTool({
            toolName,
            arguments: args
        });
        
        this.logger.info(`Executed MCP tool: ${toolName}`, {
            success: response.success,
            duration: response.duration
        });
        
        return response;
    }

    /**
     * List MCP resources
     */
    async listResources(serverName?: string): Promise<MCPResource[]> {
        if (!this.mcpManager) {
            throw new Error('MCP is not enabled for this agent');
        }
        
        if (serverName) {
            return this.mcpManager.listResources(serverName);
        }
        
        // List from all servers
        const allResources = await this.mcpManager.listAllResources();
        const resources: MCPResource[] = [];
        
        allResources.forEach(serverResources => {
            resources.push(...serverResources);
        });
        
        return resources;
    }

    /**
     * Read an MCP resource
     */
    async readResource(uri: string): Promise<ResourceReadResponse> {
        if (!this.mcpManager) {
            throw new Error('MCP is not enabled for this agent');
        }
        
        return this.mcpManager.readResource({ uri });
    }

    /**
     * Get MCP statistics
     */
    getMCPStats(): any {
        if (!this.mcpManager) {
            return null;
        }
        
        return this.mcpManager.getStats();
    }

    /**
     * Discover and connect to recommended MCP servers
     * Override this method to implement custom server discovery logic
     */
    protected async discoverMCPServers(): Promise<void> {
        // Override in subclass to auto-discover and connect to MCP servers
    }

    /**
     * Helper method to process tool results and integrate with agent logic
     */
    protected async processToolResult(toolName: string, result: any): Promise<void> {
        // Override in subclass to process tool results
        this.logger.debug(`Tool result for ${toolName}`, result);
    }
}