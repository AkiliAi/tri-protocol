// core/src/TriProtocol.ts
import { EventEmitter } from 'eventemitter3';
import { A2AProtocol } from '../../protocols/src/a2a';
import {
    AgentCard,
    AgentProfile,
    Message,
    Task,
    A2AMessage
} from '../../protocols/src/a2a';
import { LangGraphAdapter } from '../../protocols/src/langgraph';
import { MCPAdapter } from '../../protocols/src/mcp';
import type { WorkflowDefinition, WorkflowExecution } from '../../protocols/src/langgraph';

import { Logger } from '../../logger';
import { TriRegistry } from './TriRegistry';
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
    private registry: TriRegistry;

    constructor(config: TriProtocolConfig, registry?: TriRegistry) {
        super();
        this.config = config;
        this.logger = Logger.getLogger('TriProtocol');
        this.registry = registry || new TriRegistry();
        this.setupRegistryHandlers();
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
        this.logger.info('Setting up cross-protocol bridge');

        // === A2A → MCP Bridge: Allow agents to use tools ===
        if (this.a2aProtocol) {
            this.a2aProtocol.on('agent:needs:tool', async (event: any) => {
                const { agentId, toolName, args, correlationId } = event;
                this.logger.debug('Agent requesting tool', { agentId, toolName });

                if (this.mcpAdapter) {
                    try {
                        const result = await this.mcpAdapter.executeTool({
                            toolName,
                            arguments: args
                        });

                        // Send result back to agent
                        if (this.a2aProtocol) {
                            this.a2aProtocol.emit('tool:result', {
                                agentId,
                                correlationId,
                                toolName,
                                result,
                                success: true
                            });
                        }

                        this.emit('tri:cross:a2a:mcp:success', { agentId, toolName, result });
                    } catch (error) {
                        this.logger.error('Tool execution failed for agent', error, { agentId, toolName });

                        if (this.a2aProtocol) {
                            this.a2aProtocol.emit('tool:error', {
                                agentId,
                                correlationId,
                                toolName,
                                error: error instanceof Error ? error.message : String(error)
                            });
                        }

                        this.emit('tri:cross:a2a:mcp:error', { agentId, toolName, error });
                    }
                } else {
                    this.logger.warn('MCP not available for agent tool request', { agentId, toolName });
                }
            });
        }

        // === LangGraph → A2A Bridge: Workflows can communicate with agents ===
        if (this.langGraphAdapter) {
            this.langGraphAdapter.on('workflow:needs:agent', async (event: any) => {
                const { workflowId, nodeId, agentCapability, message, agentId } = event;
                this.logger.debug('Workflow requesting agent', { workflowId, agentCapability, agentId });

                if (this.a2aProtocol) {
                    try {
                        let targetAgent = agentId;

                        // Find agent by capability if not specified
                        if (!targetAgent && agentCapability) {
                            const agents = await this.a2aProtocol.findAgentsByCapability(agentCapability);
                            if (agents.length > 0) {
                                // Select best agent (simple: first one)
                                targetAgent = agents[0].agentId;
                            }
                        }

                        if (targetAgent) {
                            const result = await this.a2aProtocol.sendMessage(
                                targetAgent,
                                {
                                    role: 'user' as const,
                                    parts: [{ kind: 'text' as const, text: message }],
                                    messageId: `workflow-${workflowId}-${nodeId}`,
                                    kind: 'request' as any
                                }
                            );

                            // Send result back to workflow
                            if (this.langGraphAdapter) {
                                this.langGraphAdapter.emit('agent:response', {
                                    workflowId,
                                    nodeId,
                                    agentId: targetAgent,
                                    result
                                });
                            }

                            this.emit('tri:cross:langgraph:a2a:success', { workflowId, agentId: targetAgent });
                        } else {
                            throw new Error(`No agent found with capability: ${agentCapability}`);
                        }
                    } catch (error) {
                        this.logger.error('Agent communication failed for workflow', error, { workflowId });

                        if (this.langGraphAdapter) {
                            this.langGraphAdapter.emit('agent:error', {
                                workflowId,
                                nodeId,
                                error: error instanceof Error ? error.message : String(error)
                            });
                        }

                        this.emit('tri:cross:langgraph:a2a:error', { workflowId, error });
                    }
                } else {
                    this.logger.warn('A2A not available for workflow agent request', { workflowId });
                }
            });

            // === LangGraph → MCP Bridge: Workflows can use tools ===
            this.langGraphAdapter.on('workflow:needs:tool', async (event: any) => {
                const { workflowId, nodeId, toolName, args } = event;
                this.logger.debug('Workflow requesting tool', { workflowId, toolName });

                if (this.mcpAdapter) {
                    try {
                        const result = await this.mcpAdapter.executeTool({
                            toolName,
                            arguments: args
                        });

                        // Send result back to workflow
                        if (this.langGraphAdapter) {
                            this.langGraphAdapter.emit('tool:result', {
                                workflowId,
                                nodeId,
                                toolName,
                                result,
                                success: true
                            });
                        }

                        this.emit('tri:cross:langgraph:mcp:success', { workflowId, toolName, result });
                    } catch (error) {
                        this.logger.error('Tool execution failed for workflow', error, { workflowId, toolName });

                        if (this.langGraphAdapter) {
                            this.langGraphAdapter.emit('tool:error', {
                                workflowId,
                                nodeId,
                                toolName,
                                error: error instanceof Error ? error.message : String(error)
                            });
                        }

                        this.emit('tri:cross:langgraph:mcp:error', { workflowId, toolName, error });
                    }
                } else {
                    this.logger.warn('MCP not available for workflow tool request', { workflowId, toolName });
                }
            });
        }

        // === MCP → A2A Bridge: Tool results can be shared with agents ===
        if (this.mcpAdapter) {
            this.mcpAdapter.on('tool:completed', async (event: any) => {
                const { requestedBy, toolName, result } = event;

                // Check if requested by an agent
                if (requestedBy?.startsWith('agent:')) {
                    const agentId = requestedBy.replace('agent:', '');
                    this.logger.debug('Notifying agent of tool completion', { agentId, toolName });

                    if (this.a2aProtocol) {
                        try {
                            // Find agent and notify
                            const agents = await this.a2aProtocol.getRegisteredAgents();
                            const agent = agents.find((a: any) => a.agentId === agentId);

                            if (agent) {
                                await this.a2aProtocol.sendMessage(
                                    agentId,
                                    {
                                        role: 'agent' as const,
                                        parts: [{
                                            kind: 'text' as const,
                                            text: `Tool ${toolName} completed with result: ${JSON.stringify(result)}`
                                        }],
                                        messageId: `tool-result-${Date.now()}`,
                                        kind: 'notification' as any
                                    }
                                );

                                this.emit('tri:cross:mcp:a2a:success', { agentId, toolName });
                            }
                        } catch (error) {
                            this.logger.error('Failed to notify agent of tool result', error, { agentId, toolName });
                            this.emit('tri:cross:mcp:a2a:error', { agentId, toolName, error });
                        }
                    }
                }

                // Check if requested by a workflow
                if (requestedBy?.startsWith('workflow:')) {
                    const workflowId = requestedBy.replace('workflow:', '');
                    this.logger.debug('Tool completed for workflow', { workflowId, toolName });

                    if (this.langGraphAdapter) {
                        this.langGraphAdapter.emit('external:tool:completed', {
                            workflowId,
                            toolName,
                            result
                        });
                    }
                }
            });
        }

        // === Capability Discovery Bridge ===
        this.on('tri:a2a:capability:discovered', async (capability) => {
            // When A2A discovers a capability, make it available to all protocols
            this.emit('tri:capability:available', {
                protocol: 'a2a',
                capability
            });

            // Notify LangGraph about new capabilities
            if (this.langGraphAdapter) {
                this.langGraphAdapter.emit('capability:discovered', {
                    source: 'a2a',
                    capability
                });
            }
        });

        // === Status Synchronization ===
        // Sync agent status across protocols
        if (this.a2aProtocol) {
            this.a2aProtocol.on('agent:status:changed', (event: any) => {
                const { agentId, status } = event;

                // Notify other protocols
                this.emit('tri:agent:status:changed', { agentId, status });

                // Update any running workflows
                if (this.langGraphAdapter) {
                    this.langGraphAdapter.emit('agent:status:changed', { agentId, status });
                }
            });
        }

        this.logger.info('Cross-protocol bridge setup complete');
    }

    private setupRegistryHandlers(): void {
        // Auto-register A2A agents with registry
        this.on('tri:a2a:agent:registered', (agent: AgentProfile) => {
            this.registry.register('a2a', agent);
            this.logger.debug('Agent registered in registry', { agentId: agent.agentId });
        });

        // Auto-unregister A2A agents from registry
        this.on('tri:a2a:agent:unregistered', (agentId: string) => {
            this.registry.unregister(agentId);
            this.logger.debug('Agent unregistered from registry', { agentId });
        });

        // Registry events
        this.registry.on('agent:registered', (entry) => {
            this.emit('tri:registry:agent:registered', entry);
        });

        this.registry.on('agent:unregistered', (agentId) => {
            this.emit('tri:registry:agent:unregistered', agentId);
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

    getRegistry(): TriRegistry {
        return this.registry;
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

        // Clear adapter references
        this.a2aProtocol = undefined;
        this.langGraphAdapter = undefined;
        this.mcpAdapter = undefined;

        this.logger.info('Tri-Protocol shutdown complete');
    }
}