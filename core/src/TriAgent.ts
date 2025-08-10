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

export interface TriAgentConfig {
    id: string;
    name: string;
    type: string;
    description: string;
    capabilities: AgentCapability[];
    systemFeatures?: AgentSystemFeatures;
    metadata?: Record<string, any>;
}

export abstract class TriAgent extends EventEmitter {
    protected config: TriAgentConfig;
    protected triProtocol?: TriProtocol;
    protected status: AgentStatus = AgentStatus.OFFLINE;
    protected profile?: AgentProfile;

    constructor(config: TriAgentConfig) {
        super();
        this.config = config;
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
                ...this.config.metadata
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
}