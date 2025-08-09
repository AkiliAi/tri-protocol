


// packages/core/src/TriAgent.ts
import { EventEmitter } from 'eventemitter3';
import {
    AgentProfile,
    AgentCapability,
    AgentStatus,
    Message,
    Task
} from '../../tri-protocol/protocols/a2a/types';

export interface TriAgentConfig {
    id: string;
    name: string;
    description: string;
    capabilities: AgentCapability[];
    systemFeatures?: {
        streaming?: boolean;
        pushNotifications?: boolean;
    };
}

export abstract class TriAgent extends EventEmitter {
    protected config: TriAgentConfig;
    protected status: AgentStatus = AgentStatus.OFFLINE;
    protected triProtocol?: any; // TriProtocol instance

    constructor(config: TriAgentConfig) {
        super();
        this.config = config;
    }

    async connect(triProtocol: any): Promise<void> {
        this.triProtocol = triProtocol;

        // Register with A2A Protocol
        const profile: AgentProfile = {
            agentId: this.config.id,
            agentType: this.constructor.name,
            status: AgentStatus.ONLINE,
            capabilities: this.config.capabilities,
            systemFeatures: [{
                streaming: this.config.systemFeatures?.streaming || false,
                pushNotifications: this.config.systemFeatures?.pushNotifications || false
            }],
            metadata: {
                version: '1.0.0',
                location: `agent://${this.config.id}`,
                load: 0,
                uptime: Date.now(),
                capabilities_count: this.config.capabilities.length
            },
            lastSeen: new Date()
        };

        await triProtocol.registerAgent(profile);
        this.status = AgentStatus.ONLINE;

        this.emit('connected');
    }

    async disconnect(): Promise<void> {
        if (this.triProtocol) {
            await this.triProtocol.unregisterAgent(this.config.id);
        }
        this.status = AgentStatus.OFFLINE;
        this.emit('disconnected');
    }

    // Abstract methods to implement
    abstract processMessage(message: Message): Promise<Message | Task>;
    abstract processTask(task: Task): Promise<void>;

    // Helper methods for inter-agent communication
    protected async sendToAgent(targetAgentId: string, message: any): Promise<any> {
        if (!this.triProtocol) {
            throw new Error('Agent not connected to TriProtocol');
        }

        return this.triProtocol.sendMessage(targetAgentId, {
            role: 'agent',
            parts: [{
                kind: 'data',
                data: message
            }],
            messageId: Date.now().toString(),
            kind: 'message'
        });
    }

    protected async discoverAgents(capability?: string): Promise<AgentProfile[]> {
        if (!this.triProtocol) {
            throw new Error('Agent not connected to TriProtocol');
        }

        if (capability) {
            return this.triProtocol.findAgentsByCapability(capability);
        }

        return this.triProtocol.getRegisteredAgents();
    }
}