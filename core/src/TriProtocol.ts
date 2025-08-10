// core/src/TriProtocol.ts
import { EventEmitter } from 'eventemitter3';
import { A2AProtocol } from '@protocols/a2a/A2AProtocol';
import {
    AgentCard,
    AgentProfile,
    Message,
    Task,
    A2AMessage
} from '@protocols/a2a/types';

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
    private isInitialized = false;

    constructor(config: TriProtocolConfig) {
        super();
        this.config = config;
    }

    async initialize(): Promise<void> {
        if (this.isInitialized) return;

        console.log('🚀 Initializing Tri-Protocol...');

        // Initialize A2A Protocol
        if (this.config.protocols.a2a?.enabled) {
            await this.initializeA2A();
        }

        // Future: Initialize LangGraph
        if (this.config.protocols.langgraph?.enabled) {
            // await this.initializeLangGraph();
        }

        // Future: Initialize MCP
        if (this.config.protocols.mcp?.enabled) {
            // await this.initializeMCP();
        }

        this.setupCrossProtocolBridge();
        this.isInitialized = true;

        console.log('✅ Tri-Protocol initialized successfully');
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
        console.log('✅ A2A Protocol initialized');
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

    private setupCrossProtocolBridge(): void {
        // Bridge capabilities between protocols
        this.on('tri:a2a:capability:discovered', async (capability) => {
            // When A2A discovers a capability, it can be exposed to MCP
            this.emit('tri:capability:available', {
                protocol: 'a2a',
                capability
            });
        });

        // Future: Bridge LangGraph workflows with A2A agents
        this.on('tri:langgraph:workflow:step', async (step) => {
            if (step.requiresAgent && this.a2aProtocol) {
                const agents = await this.a2aProtocol.findAgentsByCapability(step.capability);
                // Route workflow step to appropriate agent
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
                langgraph: { enabled: false }, // Future
                mcp: { enabled: false } // Future
            }
        };
    }

    async shutdown(): Promise<void> {
        console.log('🛑 Shutting down Tri-Protocol...');

        if (this.a2aProtocol) {
            await this.a2aProtocol.shutdown();
        }

        this.removeAllListeners();
        this.isInitialized = false;

        console.log('✅ Tri-Protocol shutdown complete');
    }
}