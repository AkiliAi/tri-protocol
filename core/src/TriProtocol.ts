// packages/core/src/TriProtocol.ts
import { EventEmitter } from 'eventemitter3';
import { A2AProtocol } from 'tri-protocol/protocols/a2a';
import { LangGraphProtocol } from 'tri-protocol/protocols/langgraph';
import { MCPProtocol } from 'tri-protocol/protocols/mcp';

export interface TriProtocolConfig {
    name: string;
    version: string;
    protocols: {
        a2a?: {
            enabled: boolean;
            config?: any;
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
    private langGraphProtocol?: LangGraphProtocol;
    private mcpProtocol?: MCPProtocol;

    constructor(config: TriProtocolConfig) {
        super();
        this.config = config;
        this.initializeProtocols();
    }

    private async initializeProtocols(): Promise<void> {
        // Initialize A2A Protocol
        if (this.config.protocols.a2a?.enabled) {
            await this.initializeA2A();
        }

        // Initialize LangGraph Protocol (future)
        if (this.config.protocols.langgraph?.enabled) {
            await this.initializeLangGraph();
        }

        // Initialize MCP Protocol (future)
        if (this.config.protocols.mcp?.enabled) {
            await this.initializeMCP();
        }

        this.setupCrossProtocolBridge();
    }

    private async initializeA2A(): Promise<void> {
        const { A2AProtocol } = await import('@tri-protocol/protocols/a2a');

        this.a2aProtocol = new A2AProtocol({
            agentCard: {
                protocolVersion: '1.0',
                name: `${this.config.name}-a2a`,
                description: 'A2A Protocol for Tri-Protocol System',
                url: 'http://localhost:8080',
                preferredTransport: 'JSONRPC',
                skills: [],
                capabilities: [],
                systemFeatures: {
                    streaming: true,
                    pushNotifications: false
                }
            },
            ...this.config.protocols.a2a?.config
        });

        this.setupA2AEventHandlers();
        console.log('✅ A2A Protocol initialized');
    }

    private setupA2AEventHandlers(): void {
        if (!this.a2aProtocol) return;

        // Forward A2A events to TriProtocol level
        this.a2aProtocol.on('agent:registered', (agent) => {
            this.emit('protocol:a2a:agent:registered', agent);
        });

        this.a2aProtocol.on('message:sent', (message) => {
            this.emit('protocol:a2a:message:sent', message);
        });

        // ... other event mappings
    }

    private setupCrossProtocolBridge(): void {
        // Bridge events between protocols
        this.on('protocol:a2a:capability:discovered', async (capability) => {
            // When A2A discovers a capability, register it with MCP
            if (this.mcpProtocol) {
                await this.mcpProtocol.registerTool({
                    name: capability.name,
                    description: capability.description,
                    execute: async (params) => {
                        // Use A2A to execute the capability
                        const agent = await this.a2aProtocol.findAgentsByCapability(capability.name);
                        return this.a2aProtocol.sendMessage(agent[0].agentId, params);
                    }
                });
            }
        });
    }

    // Public API
    async registerAgent(agentConfig: any): Promise<void> {
        if (!this.a2aProtocol) {
            throw new Error('A2A Protocol not enabled');
        }

        return this.a2aProtocol.registerAgent(agentConfig);
    }

    async sendMessage(targetAgentId: string, message: any): Promise<any> {
        if (!this.a2aProtocol) {
            throw new Error('A2A Protocol not enabled');
        }

        return this.a2aProtocol.sendMessage(targetAgentId, message);
    }

    async createWorkflow(definition: any): Promise<any> {
        if (!this.langGraphProtocol) {
            throw new Error('LangGraph Protocol not enabled');
        }

        return this.langGraphProtocol.createWorkflow(definition);
    }

    async createLLMSession(config: any): Promise<any> {
        if (!this.mcpProtocol) {
            throw new Error('MCP Protocol not enabled');
        }

        return this.mcpProtocol.createSession(config);
    }

    getStatus(): any {
        return {
            name: this.config.name,
            version: this.config.version,
            protocols: {
                a2a: this.a2aProtocol ? 'active' : 'disabled',
                langgraph: this.langGraphProtocol ? 'active' : 'disabled',
                mcp: this.mcpProtocol ? 'active' : 'disabled'
            }
        };
    }
}