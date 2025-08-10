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
    AgentSystemFeatures
} from './types';

export class A2AAgentRegistry extends EventEmitter {
    private agents = new Map<string, AgentProfile>();
    private capabilities = new Map<string, Map<string, AgentCapability>>();
    private capabilityIndex = new Map<string, Set<string>>();
    private categoryIndex = new Map<CapabilityCategory, Set<string>>();
    private lastTopologyUpdate = new Date();
    private cleanupInterval?: NodeJS.Timeout;
    private config: A2AConfig;

    constructor(config: A2AConfig) {
        super();
        this.config = config;
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
    async registerAgent(profile: AgentProfile): Promise<void> {
        const agentId = profile.agentId;

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
        this.emit('agent:registered', profile);
        console.log(`[A2A Registry] Agent registered: ${agentId} with ${profile.capabilities.length} capabilities`);
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
    async findByCapability(capabilityName: string): Promise<AgentProfile[]> {
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
     * Update agent status
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
     * Get agent by ID
     */
    getAgent(agentId: string): AgentProfile | null {
        return this.agents.get(agentId) || null;
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