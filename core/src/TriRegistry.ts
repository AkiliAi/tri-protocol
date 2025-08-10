// core/src/TriRegistry.ts
import { EventEmitter } from 'eventemitter3';
import {
    AgentProfile,
    AgentCapability,
    CapabilityCategory
} from '../../protocols/src/a2a/types';

export interface RegistryEntry {
    protocol: 'a2a' | 'langgraph' | 'mcp';
    profile: AgentProfile;
    registeredAt: Date;
    lastUpdated: Date;
}

export class TriRegistry extends EventEmitter {
    private entries = new Map<string, RegistryEntry>();
    private capabilityIndex = new Map<string, Set<string>>(); // capability -> agent IDs
    private protocolIndex = new Map<string, Set<string>>(); // protocol -> agent IDs

    constructor() {
        super();
        this.initializeIndexes();
    }

    private initializeIndexes(): void {
        this.protocolIndex.set('a2a', new Set());
        this.protocolIndex.set('langgraph', new Set());
        this.protocolIndex.set('mcp', new Set());
    }

    register(protocol: 'a2a' | 'langgraph' | 'mcp', profile: AgentProfile): void {
        const entry: RegistryEntry = {
            protocol,
            profile,
            registeredAt: new Date(),
            lastUpdated: new Date()
        };

        this.entries.set(profile.agentId, entry);

        // Update protocol index
        this.protocolIndex.get(protocol)?.add(profile.agentId);

        // Update capability index
        profile.capabilities.forEach(cap => {
            if (!this.capabilityIndex.has(cap.name)) {
                this.capabilityIndex.set(cap.name, new Set());
            }
            this.capabilityIndex.get(cap.name)!.add(profile.agentId);
        });

        this.emit('agent:registered', entry);
    }

    unregister(agentId: string): void {
        const entry = this.entries.get(agentId);
        if (!entry) return;

        // Remove from indexes
        this.protocolIndex.get(entry.protocol)?.delete(agentId);

        entry.profile.capabilities.forEach(cap => {
            this.capabilityIndex.get(cap.name)?.delete(agentId);
        });

        this.entries.delete(agentId);
        this.emit('agent:unregistered', agentId);
    }

    findByCapability(capability: string): RegistryEntry[] {
        const agentIds = this.capabilityIndex.get(capability);
        if (!agentIds) return [];

        return Array.from(agentIds)
            .map(id => this.entries.get(id))
            .filter(entry => entry !== undefined) as RegistryEntry[];
    }

    findByProtocol(protocol: 'a2a' | 'langgraph' | 'mcp'): RegistryEntry[] {
        const agentIds = this.protocolIndex.get(protocol);
        if (!agentIds) return [];

        return Array.from(agentIds)
            .map(id => this.entries.get(id))
            .filter(entry => entry !== undefined) as RegistryEntry[];
    }

    get(agentId: string): RegistryEntry | undefined {
        return this.entries.get(agentId);
    }

    getAll(): RegistryEntry[] {
        return Array.from(this.entries.values());
    }

    getStats() {
        return {
            totalAgents: this.entries.size,
            byProtocol: {
                a2a: this.protocolIndex.get('a2a')?.size || 0,
                langgraph: this.protocolIndex.get('langgraph')?.size || 0,
                mcp: this.protocolIndex.get('mcp')?.size || 0
            },
            totalCapabilities: this.capabilityIndex.size
        };
    }
}