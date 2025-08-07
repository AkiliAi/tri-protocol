/**
 * Message Router - A2A Protocol Intelligent Routing
 * Handles message routing, load balancing, and performance optimization
 */

import { EventEmitter } from 'events';
import {
    A2AMessage,
    A2AMessageType,
    A2AResponse,
    A2APriority,
    AgentProfile,
    AgentStatus,
    TaskDefinition,
    TaskResult,
    Route,
    A2AConfig,
    A2AError,
    AgentNotFoundError,
    CapabilityNotFoundError,
    AgentSystemFeatures, AgentCapability

} from './types';
import { A2AAgentRegistry } from './A2AAgentRegistry';

interface QueuedMessage {
    message: A2AMessage;
    resolve: (response: A2AResponse) => void;
    reject: (error: Error) => void;
    timestamp: Date;
    retries: number;
}

export class MessageRouter extends EventEmitter {
    private registry: A2AAgentRegistry;
    private messageQueue = new Map<A2APriority, QueuedMessage[]>();
    private activeMessages = new Map<string, QueuedMessage>();
    private routingTable = new Map<string, Route[]>(); // capability -> routes
    private messageHistory = new Map<string, A2AMessage[]>(); // agent -> messages
    private config: A2AConfig;
    private messageProcessor?: NodeJS.Timeout;
    private routingUpdate?: NodeJS.Timeout;

    constructor(registry: A2AAgentRegistry, config: A2AConfig) {
        super();
        this.registry = registry;
        this.config = config;

        // Initialize priority queues
        this.messageQueue.set('urgent', []);
        this.messageQueue.set('high', []);
        this.messageQueue.set('normal', []);
        this.messageQueue.set('low', []);

        this.setupMessageProcessor();
        this.setupRoutingTableUpdater();
    }

    /**
     * Route a message to the appropriate agent(s)
     */
    async routeMessage(message: A2AMessage): Promise<A2AResponse> {
        try {
            // Validate message
            this.validateMessage(message);

            // Add to message history
            if (!this.messageHistory.has(message.from)){
                this.messageHistory.set(message.from, []);
            }
            this.messageHistory.get(message.from)!.push(message);

            // Handle different message types
            switch (message.type) {
                case A2AMessageType.TASK_REQUEST:
                    return this.routeTaskRequest(message);
                case A2AMessageType.CAPABILITY_REQUEST:
                    return this.routeCapabilityRequest(message);
                case A2AMessageType.WORKFLOW_START:
                    return this.routeWorkflowMessage(message);
                case A2AMessageType.HEALTH_CHECK:
                    return this.routeHealthCheck(message);
                case A2AMessageType.AGENT_QUERY:
                    return this.routeAgentQuery(message);
                default:
                    return this.routeGenericMessage(message);
            }
        } catch (error) {
            const errorResponse: A2AResponse = {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown routing error',
                metadata: {
                    timestamp: new Date(),
                    agentId: 'router'
                }
            };

            this.emit('message.failed', message, errorResponse.error!);
            return errorResponse;
        }
    }

    /**
     * Broadcast message to all available agents
     */
    async broadcastMessage(message: A2AMessage): Promise<A2AResponse[]> {
        // const agents = this.registry.getAllAgents();
        const agents = this.registry.getOnlineAgents();
        const responses: A2AResponse[] = [];

        const broadcastPromises = agents.map(async (agent) => {
            if (agent.status === AgentStatus.ONLINE && agent.agentId !== message.from) {
                const targetMessage = {
                    ...message,
                    to: agent.agentId,
                    id: `${message.id}-${agent.agentId}`
                };

                try {
                    const response = await this.routeMessage(targetMessage);
                    responses.push(response);
                } catch (error) {
                    responses.push({
                        success: false,
                        error: error instanceof Error ? error.message : 'Broadcast failed',
                        metadata: { agentId: agent.agentId, timestamp: new Date() }
                    });
                }
            }
        });

        await Promise.allSettled(broadcastPromises);
        return responses;
    }

    //
    // /**
    //  * Find best agent for a specific capability
    //  */


    // async findBestAgent(capability: string, criteria?: {
    //     preferLowLoad?: boolean;
    //     preferHighReliability?: boolean;
    //     excludeAgents?: string[];
    // }): Promise<AgentProfile | null> {
    //     const routes = this.routingTable.get(capability);
    //     if (!routes || routes.length === 0) {
    //         return null;
    //     }
    //
    //     let availableRoutes = routes.filter(route => {
    //         const agent = this.registry.getAgent(route.agentId);
    //         return agent &&
    //             agent.status === AgentStatus.ONLINE &&
    //             (!criteria?.excludeAgents || !criteria.excludeAgents.includes(route.agentId));
    //     });
    //
    //     if (availableRoutes.length === 0) {
    //         return null;
    //     }
    //
    //     // Apply routing algorithm
    //     const bestRoute = this.selectBestRoute(availableRoutes, criteria);
    //     return this.registry.getAgent(bestRoute.agentId) || null;
    // }

    async findBestAgent(capability: string, criteria?: {
        preferLowLoad?: boolean;
        preferHighReliability?: boolean;
        excludeAgents?: string[];
    }): Promise<AgentProfile | null> {
        const routes = this.routingTable.get(capability);
        if (!routes || routes.length === 0) {
            // Try to find agents with this capability
            const agents = await this.registry.findByCapability(capability);
            if (agents.length === 0) return null;

            // Build routes from agents
            const newRoutes = this.buildRoutesFromAgents(agents, capability);
            this.routingTable.set(capability, newRoutes);
            return this.selectBestAgentFromRoutes(newRoutes, criteria);
        }

        return this.selectBestAgentFromRoutes(routes, criteria);
    }

    /**
     * Build routes from agents
     */
    private buildRoutesFromAgents(agents: AgentProfile[], capability: string): Route[] {
        return agents.map(agent => ({
            agentId: agent.agentId,
            capability: capability,
            cost: 50, // Default cost
            reliability: 0.9, // Default reliability
            responseTime: agent.metadata.performance_metrics?.avg_response_time || 1000,
            load: agent.metadata.load
        }));
    }

    /**
     * Select best agent from routes
     */
    private selectBestAgentFromRoutes(routes: Route[], criteria?: any): AgentProfile | null {
        const bestRoute = this.selectBestRoute(routes, criteria);
        return this.registry.getAgent(bestRoute.agentId);
    }







    /**
     * Get routing statistics
     */
    getRoutingStats() {
        const queueSizes = new Map<A2APriority, number>();
        for (const [priority, queue] of this.messageQueue) {
            queueSizes.set(priority, queue.length);
        }

        return {
            activeMessages: this.activeMessages.size,
            queueSizes: Object.fromEntries(queueSizes),
            routingTableSize: this.routingTable.size,
            totalRoutes: Array.from(this.routingTable.values()).reduce((sum, routes) => sum + routes.length, 0)
        };
    }

    // ================================
    // Private Routing Methods
    // ================================

    private async routeTaskRequest(message: A2AMessage): Promise<A2AResponse> {
        const task = message.payload as TaskDefinition;

        // Find capable agents
        const agents = await this.registry.findByCapability(task.requiredCapability);
        if (agents.length === 0) {
            throw new CapabilityNotFoundError(task.requiredCapability);
        }

        // Select best agent
        const bestAgent = this.selectBestAgentForTask(agents, task);
        if (!bestAgent) {
            throw new AgentNotFoundError('No suitable agent available');
        }

        // Delegate task
        return this.delegateTask(bestAgent, message);
    }

    private async routeCapabilityRequest(message: A2AMessage): Promise<A2AResponse> {
        const query = message.payload;
        const matches = await this.registry.queryCapabilities(query);

        return {
            success: true,
            data: matches,
            metadata: {
                processingTime: Date.now() - message.timestamp.getTime(),
                agentId: 'router',
                timestamp: new Date()
            }
        };
    }

    private async routeWorkflowMessage(message: A2AMessage): Promise<A2AResponse> {
        // For workflow messages, route to workflow engine
        // This would integrate with LangGraph in Phase 9.2
        return {
            success: true,
            data: { status: 'workflow_queued' },
            metadata: {
                agentId: 'router',
                timestamp: new Date()
            }
        };
    }

    private async routeHealthCheck(message: A2AMessage): Promise<A2AResponse> {
        if (message.to === 'broadcast') {
            return this.handleHealthBroadcast(message);
        } else {
            return this.routeToSpecificAgent(message);
        }
    }

    private async routeAgentQuery(message: A2AMessage): Promise<A2AResponse> {
        const agents = this.registry.getAllAgents()
        const filteredAgents = message.payload?.filters
            ? this.applyAgentFilters(agents, message.payload.filters)
            : agents;

        return {
            success: true,
            data: filteredAgents,
            metadata: {
                processingTime: Date.now() - message.timestamp.getTime(),
                agentId: 'router',
                timestamp: new Date()
            }
        };
    }

    private async routeGenericMessage(message: A2AMessage): Promise<A2AResponse> {
        if (message.to === 'broadcast') {
            const responses = await this.broadcastMessage(message);
            return {
                success: true,
                data: responses,
                metadata: {
                    agentId: 'router',
                    timestamp: new Date()
                }
            };
        } else {
            return this.routeToSpecificAgent(message);
        }
    }

    private async routeToSpecificAgent(message: A2AMessage): Promise<A2AResponse> {
        const targetAgent = this.registry.getAgent(message.to);
        if (!targetAgent) {
            throw new AgentNotFoundError(message.to);
        }

        if (targetAgent.status !== AgentStatus.ONLINE) {
            throw new A2AError(`Agent is not online: ${message.to}`, 'AGENT_OFFLINE', message.to);
        }

        // Queue message for delivery
        return this.queueMessage(message);
    }

    private async delegateTask(agent: AgentProfile, message: A2AMessage): Promise<A2AResponse> {
        const delegationMessage: A2AMessage = {
            ...message,
            to: agent.agentId,
            type: A2AMessageType.TASK_DELEGATE,
            timestamp: new Date()
        };

        return this.queueMessage(delegationMessage);
    }

    private selectBestAgentForTask(agents: AgentProfile[], task: TaskDefinition): AgentProfile | null {
        if (agents.length === 0) return null;

        // Filter online agents
        const onlineAgents = agents.filter(agent => agent.status === AgentStatus.ONLINE);
        if (onlineAgents.length === 0) return null;

        // Apply routing algorithm
        switch (this.config.performance.routingAlgorithm) {
            case 'round-robin':
                return this.selectRoundRobin(onlineAgents, task.requiredCapability);
            case 'least-loaded':
                return this.selectLeastLoaded(onlineAgents);
            case 'best-match':
            default:
                return this.selectBestMatch(onlineAgents, task);
        }
    }

    private selectBestRoute(routes: Route[], criteria?: any): Route {
        if (routes.length === 1) return routes[0];

        return routes.sort((a, b) => {
            let scoreA = 0;
            let scoreB = 0;

            // Reliability weight (40%)
            scoreA += a.reliability * 0.4;
            scoreB += b.reliability * 0.4;

            // Load weight (30%) - lower is better
            scoreA += (100 - a.load) / 100 * 0.3;
            scoreB += (100 - b.load) / 100 * 0.3;

            // Response time weight (20%) - lower is better
            const maxResponseTime = Math.max(a.responseTime, b.responseTime, 1000);
            scoreA += (maxResponseTime - a.responseTime) / maxResponseTime * 0.2;
            scoreB += (maxResponseTime - b.responseTime) / maxResponseTime * 0.2;

            // Cost weight (10%) - lower is better
            scoreA += (100 - a.cost) / 100 * 0.1;
            scoreB += (100 - b.cost) / 100 * 0.1;

            return scoreB - scoreA; // Higher score wins
        })[0];
    }

    private selectRoundRobin(agents: AgentProfile[], capability: string): AgentProfile {
        // Simple round-robin based on agent registration order
        const agentIndex = Math.abs(capability.split('').reduce((a, b) => a + b.charCodeAt(0), 0)) % agents.length;
        return agents[agentIndex];
    }

    private getAgentCapabilities(agentId: string): AgentCapability[] {
        const agent = this.registry.getAgent(agentId);
        return agent ? agent.capabilities : [];
    }

    private selectLeastLoaded(agents: AgentProfile[]): AgentProfile {
        return agents.reduce((best, current) =>
            current.metadata.load < best.metadata.load ? current : best
        );
    }

    private selectBestMatch(agents: AgentProfile[], task: TaskDefinition): AgentProfile {
        return agents.sort((a, b) => {
            const scoreA = this.calculateAgentScore(a, task);
            const scoreB = this.calculateAgentScore(b, task);
            return scoreB - scoreA;
        })[0];
    }

    private calculateAgentScore(agent: AgentProfile, task: TaskDefinition): number {
        // const capabilities = this.getAgentCapabilities(agent.agentId);
        const relevantCap = agent.capabilities.find((cap: AgentCapability) => cap.name === task.requiredCapability);


        if (!relevantCap) return 0;

        const reliabilityScore = relevantCap.reliability * 0.4;
        const loadScore = (100 - agent.metadata.load) / 100 * 0.3;
        const performanceScore = agent.metadata.performance_metrics
            ? (agent.metadata.performance_metrics.success_rate * 0.2)
            : 0.1;
        const costScore = (100 - relevantCap.cost) / 100 * 0.1;

        return reliabilityScore + loadScore + performanceScore + costScore;
    }

    private async queueMessage(message: A2AMessage): Promise<A2AResponse> {
        return new Promise((resolve, reject) => {
            const queuedMessage: QueuedMessage = {
                message,
                resolve,
                reject,
                timestamp: new Date(),
                retries: 0
            };

            // Add to appropriate priority queue
            const queue = this.messageQueue.get(message.priority) || this.messageQueue.get('normal')!;
            queue.push(queuedMessage);

            // Track active message
            this.activeMessages.set(message.id, queuedMessage);

            this.emit('message.sent', message);
        });
    }

    private validateMessage(message: A2AMessage): void {
        if (!message.id || !message.from || !message.to || !message.type) {
            throw new A2AError('Invalid message format', 'INVALID_MESSAGE');
        }

        if (!Object.values(A2AMessageType).includes(message.type)) {
            throw new A2AError(`Invalid message type: ${message.type}`, 'INVALID_MESSAGE_TYPE');
        }
    }

    private handleHealthBroadcast(message: A2AMessage): A2AResponse {
        return {
            success: true,
            data: {
                router_status: 'healthy',
                timestamp: new Date(),
                stats: this.getRoutingStats()
            },
            metadata: {
                agentId: 'router',
                timestamp: new Date()
            }
        };
    }

    private applyAgentFilters(agents: AgentProfile[], filters: any): AgentProfile[] {
        return agents.filter(agent => {
            if (filters.status && agent.status !== filters.status) return false;
            if (filters.agentType && agent.agentType !== filters.agentType) return false;
            if (filters.maxLoad && agent.metadata.load > filters.maxLoad) return false;
            if (filters.minUptime && agent.metadata.uptime < filters.minUptime) return false;
            return true;
        });
    }

    private setupMessageProcessor(): void {
        // Process messages from queues every 10ms
        setInterval(() => {
            this.processMessageQueues();
        }, 10);
    }

    private setupRoutingTableUpdater(): void {
        // Update routing table every 30 seconds
        setInterval(() => {
            this.updateRoutingTable();
        }, 30000);

        // Initial update
        this.updateRoutingTable();
    }

    private processMessageQueues(): void {
        const priorities: A2APriority[] = ['urgent', 'high', 'normal', 'low'];

        for (const priority of priorities) {
            const queue = this.messageQueue.get(priority)!;
            if (queue.length > 0) {
                const queuedMessage = queue.shift()!;
                this.processQueuedMessage(queuedMessage);
                break; // Process one message per cycle
            }
        }
    }

    private async processQueuedMessage(queuedMessage: QueuedMessage): Promise<void> {
        try {
            // Simulate message delivery - in real implementation, this would
            // send the message to the target agent via WebSocket/HTTP
            const response: A2AResponse = {
                success: true,
                data: { message: 'Message processed by router' },
                metadata: {
                    processingTime: Date.now() - queuedMessage.timestamp.getTime(),
                    agentId: 'router',
                    timestamp: new Date()
                }
            };

            this.activeMessages.delete(queuedMessage.message.id);
            queuedMessage.resolve(response);
            this.emit('message.received', queuedMessage.message);

        } catch (error) {
            if (queuedMessage.retries < this.config.maxRetries) {
                queuedMessage.retries++;
                const queue = this.messageQueue.get(queuedMessage.message.priority)!;
                queue.push(queuedMessage);
            } else {
                this.activeMessages.delete(queuedMessage.message.id);
                queuedMessage.reject(error instanceof Error ? error : new Error('Message processing failed'));
                this.emit('message.failed', queuedMessage.message, error instanceof Error ? error.message : 'Unknown error');
            }
        }
    }

    private updateRoutingTable(): void {
        const topology = this.registry.getTopology();
        this.routingTable = topology.messageRoutes;
    }

    /**
     * Cleanup on shutdown
     */
    shutdown(): void {
        if (this.messageProcessor) {
            clearInterval(this.messageProcessor);
        }
        if (this.routingUpdate) {
            clearInterval(this.routingUpdate);
        }

        this.messageQueue.clear();
        this.activeMessages.clear();
        this.routingTable.clear();
        this.messageHistory.clear();

        this.emit('shutdown');
    }
}