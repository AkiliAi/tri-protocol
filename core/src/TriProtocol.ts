// core/src/TriProtocol.ts
import { EventEmitter } from 'eventemitter3';
import { A2AProtocol } from '@protocols/a2a';
import {
    AgentCard,
    AgentProfile,
    Message,
    Task,
    A2AMessage
} from '@protocols/a2a';
import { LangGraphAdapter } from '@protocols/langgraph';
import { MCPAdapter } from '@protocols/mcp';
import type { WorkflowDefinition, WorkflowExecution } from '@protocols/langgraph';
import { Logger } from '../../logger';
export interface TriProtocolConfig {
    name: string;
    version: string;
    baseUrl?: string;
    protocols: {
        a2a?: {
            enabled: boolean;
            agentCard?: Partial<AgentCard>;
            security?: any;
            network?: any;
        };
        langgraph?: {
            enabled: boolean;
            config?: any;
        };
        mcp?: {
            enabled: boolean;
            config?: any;
        };
    };
}

export class TriProtocol extends EventEmitter {
    private config: TriProtocolConfig;
    private a2aProtocol?: A2AProtocol;
    private langGraphAdapter?: LangGraphAdapter;
    private mcpAdapter?: MCPAdapter;
    private adapters = new Map<string, any>();
    private isInitialized = false;
    private logger: Logger;

    constructor(config: TriProtocolConfig) {
        super();
        this.config = config;
        this.logger = Logger.getLogger('TriProtocol');
    }

    async initialize(): Promise<void> {
        if (this.isInitialized) return;

        this.logger.info('Initializing Tri-Protocol...');

        // Initialize A2A Protocol
        if (this.config.protocols.a2a?.enabled) {
            await this.initializeA2A();
        }

        // Initialize LangGraph
        if (this.config.protocols.langgraph?.enabled) {
            await this.initializeLangGraph(this.config.protocols.langgraph);
        }

        // Initialize MCP
        if (this.config.protocols.mcp?.enabled) {
            await this.initializeMCP(this.config.protocols.mcp);
        }

        this.setupCrossProtocolBridge();
        this.isInitialized = true;

        this.logger.info('Tri-Protocol initialized successfully');
        this.emit('initialized');
    }

    private async initializeA2A(): Promise<void> {
        const defaultAgentCard: AgentCard = {
            protocolVersion: '1.0',
            name: `${this.config.name}-system`,
            description: 'Tri-Protocol System with A2A capabilities',
            url: this.config.baseUrl || 'http://localhost:8080',
            preferredTransport: 'JSONRPC',
            skills: [],
            capabilities: [],
            systemFeatures: {
                streaming: true,
                pushNotifications: false
            },
            securitySchemes: [],
            ...this.config.protocols.a2a?.agentCard
        };

        this.a2aProtocol = new A2AProtocol({
            agentCard: defaultAgentCard,
            security: this.config.protocols.a2a?.security,
            network: this.config.protocols.a2a?.network
        });

        this.setupA2AEventHandlers();
        this.logger.info('A2A Protocol initialized');
    }

    private setupA2AEventHandlers(): void {
        if (!this.a2aProtocol) return;

        // Forward A2A events with tri-protocol prefix
        this.a2aProtocol.on('agent:registered', (agent: AgentProfile) => {
            this.emit('tri:a2a:agent:registered', agent);
        });

        this.a2aProtocol.on('agent:unregistered', (agentId: string) => {
            this.emit('tri:a2a:agent:unregistered', agentId);
        });

        this.a2aProtocol.on('message:sent', (data: any) => {
            this.emit('tri:a2a:message:sent', data);
        });

        this.a2aProtocol.on('task:completed', (task: Task) => {
            this.emit('tri:a2a:task:completed', task);
        });
    }

    private async initializeLangGraph(config: any): Promise<void> {
        this.langGraphAdapter = new LangGraphAdapter();
        
        // Pass references to other adapters for integration
        await this.langGraphAdapter.initialize({
            ...config.config,
            a2aAdapter: this.a2aProtocol,
            mcpAdapter: this.mcpAdapter
        });
        
        this.adapters.set('langgraph', this.langGraphAdapter);
        
        // Setup LangGraph event handlers
        this.setupLangGraphEventHandlers();
        this.logger.info('LangGraph adapter initialized');
    }

    private async initializeMCP(config: any): Promise<void> {
        this.mcpAdapter = new MCPAdapter(config.config);
        
        await this.mcpAdapter.connect();
        
        this.adapters.set('mcp', this.mcpAdapter);
        
        // Setup MCP event handlers
        this.setupMCPEventHandlers();
        this.logger.info('MCP adapter initialized');
    }

    private setupLangGraphEventHandlers(): void {
        if (!this.langGraphAdapter) return;

        this.langGraphAdapter.on('workflow:completed', (data: any) => {
            this.emit('tri:workflow:completed', data);
        });

        this.langGraphAdapter.on('workflow:failed', (data: any) => {
            this.emit('tri:workflow:failed', data);
        });

        this.langGraphAdapter.on('node:executed', (data: any) => {
            this.emit('tri:workflow:node:executed', data);
        });

        this.langGraphAdapter.on('human:input:required', (data: any) => {
            this.emit('tri:workflow:human:input:required', data);
        });
    }

    private setupMCPEventHandlers(): void {
        if (!this.mcpAdapter) return;

        this.mcpAdapter.on('tool:executed', (data: any) => {
            this.emit('tri:mcp:tool:executed', data);
        });

        this.mcpAdapter.on('resource:updated', (data: any) => {
            this.emit('tri:mcp:resource:updated', data);
        });
    }

    private setupCrossProtocolBridge(): void {
        // Bridge capabilities between protocols
        this.on('tri:a2a:capability:discovered', async (capability) => {
            // When A2A discovers a capability, it can be exposed to MCP
            this.emit('tri:capability:available', {
                protocol: 'a2a',
                capability
            });
        });

        // Bridge LangGraph workflows with A2A agents
        this.on('tri:langgraph:workflow:step', async (step) => {
            if (step.requiresAgent && this.a2aProtocol) {
                const agents = await this.a2aProtocol.findAgentsByCapability(step.capability);
                // Route workflow step to appropriate agent
                if (agents.length > 0 && this.langGraphAdapter) {
                    // LangGraph can now use these agents
                    this.emit('tri:agents:available', { step, agents });
                }
            }
        });

        // Bridge MCP tools with LangGraph workflows
        this.on('tri:langgraph:tool:required', async (toolRequest) => {
            if (this.mcpAdapter) {
                const result = await this.mcpAdapter.executeTool({
                    toolName: toolRequest.tool,
                    arguments: toolRequest.args
                });
                this.emit('tri:tool:result', { request: toolRequest, result });
            }
        });
    }

    // === A2A Protocol Methods ===

    async registerAgent(profile: AgentProfile): Promise<void> {
        if (!this.a2aProtocol) {
            throw new Error('A2A Protocol not enabled');
        }
        return this.a2aProtocol.registerAgent(profile);
    }

    async unregisterAgent(agentId: string): Promise<void> {
        if (!this.a2aProtocol) {
            throw new Error('A2A Protocol not enabled');
        }
        return this.a2aProtocol.unregisterAgent(agentId);
    }

    async sendMessage(targetAgentId: string, message: Message, config?: any): Promise<Task | Message> {
        if (!this.a2aProtocol) {
            throw new Error('A2A Protocol not enabled');
        }
        return this.a2aProtocol.sendMessage(targetAgentId, message, config);
    }

    async findAgentsByCapability(capability: string): Promise<AgentProfile[]> {
        if (!this.a2aProtocol) {
            throw new Error('A2A Protocol not enabled');
        }
        return this.a2aProtocol.findAgentsByCapability(capability);
    }

    async routeMessage(message: A2AMessage): Promise<any> {
        if (!this.a2aProtocol) {
            throw new Error('A2A Protocol not enabled');
        }
        return this.a2aProtocol.routeMessage(message);
    }

    // === LangGraph Workflow Methods ===

    async createWorkflow(definition: WorkflowDefinition): Promise<string> {
        if (!this.langGraphAdapter) {
            throw new Error('LangGraph not enabled');
        }
        return this.langGraphAdapter.createWorkflow(definition);
    }

    async executeWorkflow(workflowId: string, input: any, config?: any): Promise<WorkflowExecution> {
        if (!this.langGraphAdapter) {
            throw new Error('LangGraph not enabled');
        }
        return this.langGraphAdapter.executeWorkflow(workflowId, input, config);
    }

    async pauseWorkflow(executionId: string): Promise<void> {
        if (!this.langGraphAdapter) {
            throw new Error('LangGraph not enabled');
        }
        return this.langGraphAdapter.pauseWorkflow(executionId);
    }

    async resumeWorkflow(executionId: string): Promise<void> {
        if (!this.langGraphAdapter) {
            throw new Error('LangGraph not enabled');
        }
        return this.langGraphAdapter.resumeWorkflow(executionId);
    }

    submitHumanInput(nodeId: string, input: any, userId?: string): void {
        if (!this.langGraphAdapter) {
            throw new Error('LangGraph not enabled');
        }
        this.langGraphAdapter.submitHumanInput(nodeId, input, userId);
    }

    // === MCP Tool Methods ===

    async executeTool(toolName: string, args: any): Promise<any> {
        if (!this.mcpAdapter) {
            throw new Error('MCP not enabled');
        }
        return this.mcpAdapter.executeTool({
            toolName,
            arguments: args
        });
    }

    async listTools(): Promise<any[]> {
        if (!this.mcpAdapter) {
            throw new Error('MCP not enabled');
        }
        // MCP adapter doesn't have a listTools method, so we'll return resources
        const resources = await this.mcpAdapter.listResources();
        // Convert to array if it's a Map
        if (resources instanceof Map) {
            return Array.from(resources.values()).flat();
        }
        return resources as any[];
    }

    // === Protocol Access Methods ===

    getA2A(): A2AProtocol | undefined {
        return this.a2aProtocol;
    }

    getLangGraph(): LangGraphAdapter | undefined {
        return this.langGraphAdapter;
    }

    getMCP(): MCPAdapter | undefined {
        return this.mcpAdapter;
    }

    // === Status and Monitoring ===

    getStatus(): any {
        return {
            name: this.config.name,
            version: this.config.version,
            initialized: this.isInitialized,
            protocols: {
                a2a: this.a2aProtocol ? {
                    enabled: true,
                    agents: this.a2aProtocol.getRegisteredAgents().length,
                    tasks: this.a2aProtocol.getActiveTasks().length
                } : { enabled: false },
                langgraph: this.langGraphAdapter ? {
                    enabled: true,
                    workflows: this.langGraphAdapter.listWorkflows().length,
                    executions: this.langGraphAdapter.listExecutions().length
                } : { enabled: false },
                mcp: this.mcpAdapter ? {
                    enabled: true,
                    connected: true
                } : { enabled: false }
            }
        };
    }

    async shutdown(): Promise<void> {
        this.logger.info('Shutting down Tri-Protocol...');

        if (this.a2aProtocol) {
            await this.a2aProtocol.shutdown();
        }

        if (this.langGraphAdapter) {
            await this.langGraphAdapter.shutdown();
        }

        if (this.mcpAdapter) {
            await this.mcpAdapter.disconnect();
        }

        this.adapters.clear();
        this.removeAllListeners();
        this.isInitialized = false;

        this.logger.info('Tri-Protocol shutdown complete');
    }
}