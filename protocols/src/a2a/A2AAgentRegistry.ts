/**
 * Agent Registry - A2A Protocol Discovery System
 * Manages agent registration, discovery, and capability matching
 * Fist Core (Alpha) Protocol of the Tri Protocol
 */





// packages/protocols/src/a2a/A2AAgentRegistry.ts
import { EventEmitter } from 'eventemitter3';
import { v4 as uuidv4 } from 'uuid';
import {
    AgentProfile,
    AgentCapability,
    AgentStatus,
    CapabilityQuery,
    CapabilityMatch,
    CapabilityCategory,
    NetworkTopology,
    Route,
    A2AMessage,
    A2AMessageType,
    AgentNotFoundError,
    A2AConfig,
    AgentSystemFeatures, AgentHealth
} from './types';

export class A2AAgentRegistry extends EventEmitter {
    private agents = new Map<string, AgentProfile>();
    private capabilities = new Map<string, Map<string, AgentCapability>>();
    private capabilityIndex = new Map<string, Set<string>>();
    private categoryIndex = new Map<CapabilityCategory, Set<string>>();
    private lastTopologyUpdate = new Date();
    private cleanupInterval?: NodeJS.Timeout;
    private config?: A2AConfig;
    private agentHealth = new Map<string, AgentHealth>();

    constructor(configOrEventBus: A2AConfig | EventEmitter) {
        super();
        
        // Handle both constructor signatures for backward compatibility
        if (configOrEventBus instanceof EventEmitter) {
            // Test mode - EventEmitter passed
            // No config needed for tests
        } else {
            // Production mode - A2AConfig passed
            this.config = configOrEventBus;
        }
        
        this.setupCleanupInterval();
        this.initializeCategoryIndex();
    }

    /**
     * Initialize category index
     */
    private initializeCategoryIndex(): void {
        // Initialize all categories
        Object.values(CapabilityCategory).forEach(category => {
            this.categoryIndex.set(category, new Set());
        });
    }

    /**
     * Register an agent with its capabilities
     */
    async registerAgent(profile: AgentProfile): Promise<{ success: boolean; agentId?: string; error?: string }> {
        const agentId = profile.agentId;

        // Validate agent profile
        if (!agentId || !profile.capabilities || !profile.agentType) {
            return { success: false, error: 'Invalid agent profile' };
        }

        // Check for duplicate registration
        if (this.agents.has(agentId)) {
            return { success: false, error: `Agent ${agentId} already registered` };
        }

        // Add metadata if not present
        if (!profile.metadata) {
            profile.metadata = {} as any;
        }
        if (!profile.metadata.registeredAt) {
            profile.metadata.registeredAt = new Date();
        }

        // Store agent profile
        this.agents.set(agentId, profile);

        // Store capabilities


        const agentCaps = new Map<string, AgentCapability>();
        profile.capabilities.forEach(cap => {
            agentCaps.set(cap.name, cap);

            // Update capability index
            if (!this.capabilityIndex.has(cap.name)) {
                this.capabilityIndex.set(cap.name, new Set());
            }
            this.capabilityIndex.get(cap.name)!.add(agentId);

            // Update category index
            const categorySet = this.categoryIndex.get(cap.category);
            if (categorySet) {
                categorySet.add(agentId);
            }
        });

        this.capabilities.set(agentId, agentCaps);

        // Update network topology
        this.updateTopology();

        // Emit events
        this.emit('agent:registered', {
            agentId,
            profile,
            timestamp: Date.now()
        });
        console.log(`[A2A Registry] Agent registered: ${agentId} with ${profile.capabilities.length} capabilities`);

        return { success: true, agentId };
    }

    /**
     * Bulk register multiple agents
     */

    async bulkRegister(agents: AgentProfile[]): Promise<{ successful: number; failed: number; errors?: string[] }> {
        let successful = 0;
        let failed = 0;
        const errors: string[] = [];

        for (const agent of agents) {
            const result = await this.registerAgent(agent);
            if (result.success) {
                successful++;
            } else {
                failed++;
                if (result.error) {
                    errors.push(result.error);
                }
            }
        }
        
        this.emit('network:topology:changed', this.getTopology());
        
        const result: { successful: number; failed: number; errors?: string[] } = { successful, failed };
        if (errors.length > 0) {
            result.errors = errors;
        }
        return result;
    }

    /**
     * Unregister an agent
     */
    async unregisterAgent(agentId: string): Promise<void> {
        const agent = this.agents.get(agentId);
        if (!agent) {
            return;
        }

        // Remove from all indices
        await this.removeAgentFromIndices(agentId);

        // Remove agent
        this.agents.delete(agentId);
        this.capabilities.delete(agentId);

        // Update topology
        this.updateTopology();

        // Emit events
        this.emit('agent:unregistered', agentId);
        this.emit('network:topology:changed', this.getTopology());

        console.log(`[A2A Registry] Agent unregistered: ${agentId}`);
    }

    async bulkUnregister(agentIds: string[]): Promise<{ successful: number; failed: number }> {
        let successful = 0;
        let failed = 0;

        for (const agentId of agentIds) {
            if (this.agents.has(agentId)) {
                await this.unregisterAgent(agentId);
                successful++;
            } else {
                failed++;
            }
        }
        
        this.emit('network:topology:changed', this.getTopology());
        return { successful, failed };
    }



    /**
     * Remove agent from all indices
     */
    private async removeAgentFromIndices(agentId: string): Promise<void> {
        // Remove from capability index
        const agentCaps = this.capabilities.get(agentId);
        if (agentCaps) {
            agentCaps.forEach(cap => {
                const capAgents = this.capabilityIndex.get(cap.name);
                if (capAgents) {
                    capAgents.delete(agentId);
                    if (capAgents.size === 0) {
                        this.capabilityIndex.delete(cap.name);
                    }
                }

                // Remove from category index
                const categoryAgents = this.categoryIndex.get(cap.category);
                if (categoryAgents) {
                    categoryAgents.delete(agentId);
                }
            });
        }
    }

    /**
     * Query capabilities based on criteria
     */
    async queryCapabilities(query: CapabilityQuery): Promise<CapabilityMatch[]> {
        const matches: CapabilityMatch[] = [];

        // Search through all agents
        for (const [agentId, agent] of this.agents) {
            // Skip offline agents unless explicitly requested
            if (agent.status !== AgentStatus.ONLINE && query.filters?.availability !== false) {
                continue;
            }

            const agentCaps = this.capabilities.get(agentId);
            if (!agentCaps) continue;

            // Check each capability
            for (const [capId, capability] of agentCaps) {
                const match = this.evaluateCapabilityMatch(capability, agent, query);
                if (match) {
                    matches.push(match);
                }
            }
        }

        // Sort by score and apply limit
        matches.sort((a, b) => b.score - a.score);

        if (query.limit) {
            return matches.slice(0, query.limit);
        }

        return matches;
    }

    /**
     * Evaluate if a capability matches the query
     */
    private evaluateCapabilityMatch(
        capability: AgentCapability,
        agent: AgentProfile,
        query: CapabilityQuery
    ): CapabilityMatch | null {
        let score = 0;
        let reasons: string[] = [];

        // Text matching
        const searchText = query.query.toLowerCase();
        const capText = `${capability.name} ${capability.description}`.toLowerCase();

        if (capText.includes(searchText)) {
            score += 50;
            reasons.push('Name/description match');
        }

        // Check filters
        if (query.filters) {
            // Category filter
            if (query.filters.category && capability.category !== query.filters.category) {
                return null;
            }

            // Tag filter
            if (query.filters.tags && capability.tags) {
                const matchingTags = query.filters.tags.filter(tag =>
                    capability.tags?.includes(tag)
                );
                if (matchingTags.length === 0) {
                    return null;
                }
                score += matchingTags.length * 10;
                reasons.push(`Matching tags: ${matchingTags.join(', ')}`);
            }

            // Reliability filter
            if (query.filters.minReliability && capability.reliability < query.filters.minReliability) {
                return null;
            }

            // Cost filter
            if (query.filters.maxCost && capability.cost > query.filters.maxCost) {
                return null;
            }
        }

        // Boost score based on agent performance
        if (agent.metadata.performance_metrics) {
            score += agent.metadata.performance_metrics.success_rate * 20;
            reasons.push(`High success rate: ${agent.metadata.performance_metrics.success_rate}`);
        }

        // Normalize score
        score = Math.min(score / 100, 1);

        if (score > 0) {
            return {
                agent,
                capability,
                score,
                reason: reasons.join('; ')
            };
        }

        return null;
    }

    /**
     * Find agents by capability name
     */
    async findByCapability(capabilityName: string | string[]): Promise<AgentProfile[]> {
        // Handle array of capabilities
        if (Array.isArray(capabilityName)) {
            const agents: AgentProfile[] = [];
            const foundIds = new Set<string>();
            
            for (const cap of capabilityName) {
                const agentIds = this.capabilityIndex.get(cap);
                if (agentIds) {
                    for (const agentId of agentIds) {
                        if (!foundIds.has(agentId)) {
                            const agent = this.agents.get(agentId);
                            if (agent && agent.status === AgentStatus.ONLINE) {
                                // Check if agent has ALL requested capabilities
                                const agentCaps = this.capabilities.get(agentId);
                                if (agentCaps) {
                                    const hasAll = capabilityName.every(reqCap => 
                                        agentCaps.has(reqCap)
                                    );
                                    if (hasAll) {
                                        agents.push(agent);
                                        foundIds.add(agentId);
                                    }
                                }
                            }
                        }
                    }
                }
            }
            return agents;
        }

        // Original single capability logic
        const agentIds = this.capabilityIndex.get(capabilityName);
        if (!agentIds) {
            return [];
        }

        const agents: AgentProfile[] = [];
        for (const agentId of agentIds) {
            const agent = this.agents.get(agentId);
            if (agent && agent.status === AgentStatus.ONLINE) {
                agents.push(agent);
            }
        }

        return agents;
    }

    /**
     * Find agents by category
     */
    async findByCategory(category: CapabilityCategory): Promise<AgentProfile[]> {
        const agentIds = this.categoryIndex.get(category);
        if (!agentIds) {
            return [];
        }

        const agents: AgentProfile[] = [];
        for (const agentId of agentIds) {
            const agent = this.agents.get(agentId);
            if (agent && agent.status === AgentStatus.ONLINE) {
                agents.push(agent);
            }
        }

        return agents;
    }

    /**
     * R
     * Get capability distribution across agents
     */

    async getCapabilityDistribution(): Promise<{ [key: string]: number }> {
        const distribution: { [key: string]: number } = {};

        // Count capabilities by name
        for (const [agentId, agentCaps] of this.capabilities) {
            for (const cap of agentCaps.values()) {
                if (!distribution[cap.name]) {
                    distribution[cap.name] = 0;
                }
                distribution[cap.name]++;
            }
        }

        return distribution;
    }

    /**
     * Find agents by type
     */
    async findByType(agentType: string): Promise<AgentProfile[]> {
        return this.getAllAgents().filter(agent => agent.agentType === agentType);
    }

    /**
     * Find agents by status
     */
    async findByStatus(status: AgentStatus): Promise<AgentProfile[]> {
        return this.getAllAgents().filter(agent => agent.status === status);
    }

    /**
     * Find agents by complex query
     */
    async findByQuery(query: {
        capabilities?: string[];
        status?: AgentStatus;
        agentType?: string;
    }): Promise<AgentProfile[]> {
        return this.getAllAgents().filter(agent => {
            if (query.status && agent.status !== query.status) return false;
            if (query.agentType && agent.agentType !== query.agentType) return false;
            if (query.capabilities) {
                const agentCaps = agent.capabilities.map(c => c.name);
                return query.capabilities.every(cap => agentCaps.includes(cap));
            }
            return true;
        });
    }



    /**
     * Update agent status
     */
    async updateStatus(agentId: string, status: AgentStatus): Promise<void> {
        return this.updateAgentStatus(agentId, status);
    }

    /**
     * Update agent status (internal method)
     */
    async updateAgentStatus(agentId: string, status: AgentStatus): Promise<void> {
        const agent = this.agents.get(agentId);
        if (!agent) {
            throw new AgentNotFoundError(agentId);
        }

        agent.status = status;
        agent.lastSeen = new Date();
        agent.metadata.uptime = Date.now() - agent.metadata.uptime;

        this.emit('agent:status:changed', { agentId, status });
    }


    /**
     * Update agent capabilities
     */
    async updateCapabilities(agentId: string, capabilities: AgentCapability[]): Promise<void> {
        const agent = this.agents.get(agentId);
        if (!agent) {
            throw new AgentNotFoundError(agentId);
        }

        // Remove old capability mappings
        await this.removeAgentFromIndices(agentId);

        // Update capabilities
        agent.capabilities = capabilities;

        // Re-index with new capabilities
        const agentCaps = new Map<string, AgentCapability>();
        capabilities.forEach(cap => {
            agentCaps.set(cap.name, cap);

            if (!this.capabilityIndex.has(cap.name)) {
                this.capabilityIndex.set(cap.name, new Set());
            }
            this.capabilityIndex.get(cap.name)!.add(agentId);

            const categorySet = this.categoryIndex.get(cap.category);
            if (categorySet) {
                categorySet.add(agentId);
            }
        });

        this.capabilities.set(agentId, agentCaps);
        this.updateTopology();
        this.emit('agent:updated', { agentId, updates: { capabilities } });
    }

    /**
     * Update last seen timestamp
     */
    async updateLastSeen(agentId: string): Promise<void> {
        const agent = this.agents.get(agentId);
        if (!agent) {
            throw new AgentNotFoundError(agentId);
        }

        agent.lastSeen = new Date();
        this.emit('agent:updated', { agentId, updates: { lastSeen: agent.lastSeen } });
    }

    /**
     * Get network topology
     */
    getTopology(): NetworkTopology {
        const connections = new Map<string, string[]>();
        const messageRoutes = new Map<string, Route[]>();

        // Build connection map (simplified - in real implementation would track actual connections)
        for (const [agentId, agent] of this.agents) {
            if (agent.status === AgentStatus.ONLINE) {
                connections.set(agentId, []);

                // Create routes for each capability
                const agentCaps = this.capabilities.get(agentId);
                if (agentCaps) {
                    agentCaps.forEach(cap => {
                        const route: Route = {
                            agentId,
                            capability: cap.name,
                            cost: cap.cost,
                            reliability: cap.reliability,
                            responseTime: agent.metadata.performance_metrics?.avg_response_time || 1000,
                            load: agent.metadata.load
                        };

                        if (!messageRoutes.has(cap.name)) {
                            messageRoutes.set(cap.name, []);
                        }
                        messageRoutes.get(cap.name)!.push(route);
                    });
                }
            }
        }

        return {
            agents: new Map(this.agents),
            connections,
            messageRoutes,
            lastUpdated: this.lastTopologyUpdate
        };
    }

    /**
     * Update network topology
     */
    private updateTopology(): void {
        this.lastTopologyUpdate = new Date();
        this.emit('network:topology:changed', this.getTopology());
    }

    /**
     * Get network statistics
     */
    getNetworkStats() {
        const totalAgents = this.agents.size;
        const onlineAgents = Array.from(this.agents.values())
            .filter(agent => agent.status === AgentStatus.ONLINE).length;
        const totalCapabilities = Array.from(this.capabilities.values())
            .reduce((sum, caps) => sum + caps.size, 0);
        const uniqueCapabilities = this.capabilityIndex.size;

        return {
            totalAgents,
            onlineAgents,
            offlineAgents: totalAgents - onlineAgents,
            totalCapabilities,
            uniqueCapabilities,
            categories: Array.from(this.categoryIndex.keys()).map(cat => ({
                name: cat,
                count: this.categoryIndex.get(cat)?.size || 0
            })),
            lastTopologyUpdate: this.lastTopologyUpdate
        };
    }



    private agentMetadata = new Map<string, Record<string, any>>();

    /**
     * Set custom metadata for an agent
     */
    async setMetadata(agentId: string, key: string, value: any): Promise<void> {
        const agent = this.agents.get(agentId);
        if (!agent) {
            throw new AgentNotFoundError(agentId);
        }

        if (!this.agentMetadata.has(agentId)) {
            this.agentMetadata.set(agentId, {});
        }

        const metadata = this.agentMetadata.get(agentId)!;
        metadata[key] = value;

        // Also update in agent profile
        (agent.metadata as any)[key] = value;
    }

    /**
     * Get all metadata for an agent
     */
    async getMetadata(agentId: string): Promise<Record<string, any> | undefined> {
        return this.agentMetadata.get(agentId);
    }

    /**
     * Merge metadata updates
     */
    async mergeMetadata(agentId: string, updates: Record<string, any>): Promise<void> {
        const agent = this.agents.get(agentId);
        if (!agent) {
            throw new AgentNotFoundError(agentId);
        }

        Object.assign(agent.metadata, updates);

        if (!this.agentMetadata.has(agentId)) {
            this.agentMetadata.set(agentId, {});
        }
        Object.assign(this.agentMetadata.get(agentId)!, updates);
    }

    /**
     * Delete metadata field
     */
    async deleteMetadata(agentId: string, key: string): Promise<void> {
        const agent = this.agents.get(agentId);
        if (!agent) {
            throw new AgentNotFoundError(agentId);
        }

        delete (agent.metadata as any)[key];

        const metadata = this.agentMetadata.get(agentId);
        if (metadata) {
            delete metadata[key];
        }
    }

    /**
     * Update agent health metrics
     */
    async updateHealth(agentId: string, health: AgentHealth): Promise<void> {
        const agent = this.agents.get(agentId);
        if (!agent) {
            throw new AgentNotFoundError(agentId);
        }

        this.agentHealth.set(agentId, health);
        this.emit('agent:health:updated', { agentId, health });
    }

    /**
     * Get agent health
     */
    async getHealth(agentId: string): Promise<AgentHealth | undefined> {
        return this.agentHealth.get(agentId);
    }

    /**
     * Get unhealthy agents
     */
    async getUnhealthyAgents(thresholds: {
        maxCpu?: number;
        maxMemory?: number;
        maxResponseTime?: number;
        maxErrorRate?: number;
    }): Promise<AgentProfile[]> {
        const unhealthy: AgentProfile[] = [];

        for (const [agentId, health] of this.agentHealth) {
            const agent = this.agents.get(agentId);
            if (!agent) continue;

            const isUnhealthy =
                (thresholds.maxCpu && health.cpu > thresholds.maxCpu) ||
                (thresholds.maxMemory && health.memory > thresholds.maxMemory) ||
                (thresholds.maxResponseTime && health.responseTime > thresholds.maxResponseTime) ||
                (thresholds.maxErrorRate && health.errorRate > thresholds.maxErrorRate);

            if (isUnhealthy) {
                unhealthy.push(agent);
            }
        }

        return unhealthy;
    }

    /**
     * Check health and update status
     */
    async checkHealthAndUpdateStatus(agentId: string): Promise<void> {
        const health = this.agentHealth.get(agentId);
        if (!health) return;

        // Define thresholds for degraded status
        const isDegraded =
            health.cpu > 90 ||
            health.memory > 90 ||
            health.responseTime > 5000 ||
            health.errorRate > 0.2;

        if (isDegraded) {
            await this.updateAgentStatus(agentId, AgentStatus.DEGRADED);
        }
    }

    /**
     * Get inactive agents
     */
    async getInactiveAgents(thresholdMs: number): Promise<AgentProfile[]> {
        const now = Date.now();
        return this.getAllAgents().filter(agent => {
            const inactiveTime = now - agent.lastSeen.getTime();
            return inactiveTime > thresholdMs;
        });
    }

    /**
     * Cleanup inactive agents
     */
    async cleanupInactive(thresholdMs: number): Promise<string[]> {
        const inactive = await this.getInactiveAgents(thresholdMs);
        const removed: string[] = [];

        for (const agent of inactive) {
            await this.unregisterAgent(agent.agentId);
            removed.push(agent.agentId);
        }

        this.emit('agents:cleanup', { removed, timestamp: Date.now() });
        return removed;
    }

    /**
     * Get detailed statistics
     */
    async getStatistics(): Promise<{
        totalAgents: number;
        onlineAgents: number;
        busyAgents: number;
        offlineAgents: number;
        degradedAgents?: number;
    }> {
        const agents = this.getAllAgents();

        return {
            totalAgents: agents.length,
            onlineAgents: agents.filter(a => a.status === AgentStatus.ONLINE).length,
            busyAgents: agents.filter(a => a.status === AgentStatus.BUSY).length,
            offlineAgents: agents.filter(a => a.status === AgentStatus.OFFLINE).length,
            degradedAgents: agents.filter(a => a.status === AgentStatus.DEGRADED).length
        };
    }











    /**
     * Setup periodic cleanup of offline agents
     */
    private setupCleanupInterval(): void {
        const interval = 60000; // 1 minute

        this.cleanupInterval = setInterval(() => {
            this.cleanupOfflineAgents();
        }, interval);
    }

    /**
     * Cleanup offline agents
     */
    private cleanupOfflineAgents(): void {
        const now = Date.now();
        const timeout = 300000; // 5 minutes

        for (const [agentId, agent] of this.agents) {
            if (agent.status === AgentStatus.OFFLINE) {
                const offlineTime = now - agent.lastSeen.getTime();
                if (offlineTime > timeout) {
                    this.unregisterAgent(agentId);
                    console.log(`[A2A Registry] Removed offline agent: ${agentId}`);
                }
            }
        }
    }

    /**
     * Get agent by ID (synchronous)
     */
    getAgentSync(agentId: string): AgentProfile | null {
        return this.agents.get(agentId) || null;
    }

    /**
     * Get agent by ID (async for compatibility with tests)
     */
    async getAgent(agentId: string): Promise<AgentProfile | null> {
        return this.getAgentSync(agentId);
    }

    /**
     * Get all agents
     */
    getAllAgents(): AgentProfile[] {
        return Array.from(this.agents.values());
    }

    /**
     * Get online agents
     */
    getOnlineAgents(): AgentProfile[] {
        return this.getAllAgents().filter(agent => agent.status === AgentStatus.ONLINE);
    }

    /**
     * Shutdown registry
     */
    shutdown(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }

        this.agents.clear();
        this.capabilities.clear();
        this.capabilityIndex.clear();
        this.categoryIndex.clear();

        this.emit('shutdown');
    }
}