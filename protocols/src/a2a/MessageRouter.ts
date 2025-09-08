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
    AgentSystemFeatures, AgentCapability, AgentCard, MessageSendParameters, SendMessageResponse, Part, Message, Task

} from './types';
import { A2AAgentRegistry } from './A2AAgentRegistry';
import { A2AClient,A2AClientConfig} from "./A2AClient";


interface QueuedMessage {
    message: A2AMessage;
    resolve: (response: A2AResponse) => void;
    reject: (error: Error) => void;
    timestamp: Date;
    retries: number;
}

interface CircuitBreakerConfig {
    failureThreshold: number;      // Number of failures before opening (default: 5)
    successThreshold: number;       // Number of successes to close (default: 2)
    timeout: number;               // Time before half-open in ms (default: 60000)
    monitoringPeriod: number;      // Monitoring window in ms (default: 120000)
}

interface CircuitBreakerState {
    status: 'closed' | 'open' | 'half-open';
    failures: number;
    successes: number;
    lastFailureTime?: Date;
    lastSuccessTime?: Date;
    nextAttempt?: Date;
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
    
    // Circuit Breaker additions
    private circuitBreakers = new Map<string, CircuitBreakerState>();
    private circuitConfig: CircuitBreakerConfig = {
        failureThreshold: 5,
        successThreshold: 2,
        timeout: 60000, // 1 minute
        monitoringPeriod: 120000 // 2 minutes
    };
    private circuitBreakerConfigs = new Map<string, CircuitBreakerConfig>();

    private clientPool = new Map<string, A2AClient>();
    private agentEndpoints = new Map<string, string>(); // agentId -> endpoint URL

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
        this.initializeAgentEndpoints();
    }

    /**
     * Initialize agent endpoints from registry
     */

    private async initializeAgentEndpoints(): Promise<void> {
        // Initialize agent endpoints from registry
        const agents = this.registry.getAllAgents();
        for (const agent of agents) {
            // Extraire l'URL depuis les métadonnées ou utiliser une convention
            const endpoint = agent.metadata.location ;
            if(!endpoint) {
                console.warn(`⚠️ No endpoint for agent ${agent.agentId}`);
                continue;
            }
            this.agentEndpoints.set(agent.agentId, endpoint);
        }


        // Initialize circuit breakers for all agents
        for (const agent of agents) {
            this.enableCircuitBreaker(agent.agentId);
        }

    }

    /**
     * Get or create A2AClient for an agent
     */
    private getOrCreateClient(agentId: string): A2AClient {
        if (!this.clientPool.has(agentId)) {
            const endpoint = this.agentEndpoints.get(agentId);
            if (!endpoint) {
                throw new AgentNotFoundError(`No endpoint configured for agent: ${agentId}`);
            }

            const clientConfig: A2AClientConfig = {
                timeout: this.config.messageTimeout || 30000,
                retries: this.config.maxRetries || 3,
                headers: {
                    'X-Router-Id': 'message-router',
                    'X-Source-Agent': 'router'
                }
            };

            const client = new A2AClient(endpoint, '/.well-known/ai-agent', clientConfig);

            // Écouter les événements du client
            this.setupClientEventHandlers(client, agentId);

            this.clientPool.set(agentId, client);
        }

        return this.clientPool.get(agentId)!;
    }

    /**
     * Setup event handlers for client
     */
    private setupClientEventHandlers(client: A2AClient, agentId: string): void {
        client.on('agentCard:fetched', (card) => {
            this.emit('agent:discovered', { agentId, card });
            // Mettre à jour le registry avec les capacités découvertes
            this.updateAgentCapabilities(agentId, card);
        });

        client.on('error', (error) => {
            this.emit('client:error', { agentId, error });
            this.recordFailure(agentId, error);
        });

        client.on('message:sent', (message) => {
            this.emit('transport:sent', { agentId, message });
        });
    }

    /**
     * Update agent capabilities from discovered card
     */
    private updateAgentCapabilities(agentId: string, card: AgentCard): void {
        const agent = this.registry.getAgentSync(agentId);
        if (agent && card.capabilities) {
            // Mettre à jour les capacités dans le registry
            this.registry.updateCapabilities(agentId, card.capabilities);
        }
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
                    return await this.routeTaskRequest(message);
                case A2AMessageType.CAPABILITY_REQUEST:
                    return await this.routeCapabilityRequest(message);
                case A2AMessageType.WORKFLOW_START:
                    return await this.routeWorkflowMessage(message);
                case A2AMessageType.HEALTH_CHECK:
                    return await this.routeHealthCheck(message);
                case A2AMessageType.AGENT_QUERY:
                    return await this.routeAgentQuery(message);
                default:
                    return await this.routeGenericMessage(message);
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


    /**
     * Find best agent for a specific capability
     */


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
        return this.registry.getAgentSync(bestRoute.agentId) || null;
    }







    /**
     * Get routing statistics
     */
    getRoutingStats() {
        const queueSizes = new Map<A2APriority, number>();
        for (const [priority, queue] of this.messageQueue) {
            queueSizes.set(priority, queue.length);
        }

        // Circuit breaker stats
        const circuitStats = {
            total: this.circuitBreakers.size,
            open: 0,
            halfOpen: 0,
            closed: 0
        };
        
        for (const breaker of this.circuitBreakers.values()) {
            switch (breaker.status) {
                case 'open': circuitStats.open++; break;
                case 'half-open': circuitStats.halfOpen++; break;
                case 'closed': circuitStats.closed++; break;
            }
        }

        return {
            activeMessages: this.activeMessages.size,
            queueSizes: Object.fromEntries(queueSizes),
            routingTableSize: this.routingTable.size,
            totalRoutes: Array.from(this.routingTable.values()).reduce((sum, routes) => sum + routes.length, 0),
            circuitBreakers: circuitStats
        };
    }

    // ================================
    // Circuit Breaker Methods
    // ================================
    
    /**
     * Enable circuit breaker for a specific agent
     */
    public enableCircuitBreaker(
        agentId: string, 
        config?: Partial<CircuitBreakerConfig>
    ): void {
        const finalConfig = { ...this.circuitConfig, ...config };
        
        this.circuitBreakers.set(agentId, {
            status: 'closed',
            failures: 0,
            successes: 0
        });
        
        // Store custom config if provided
        if (config) {
            this.circuitBreakerConfigs.set(agentId, finalConfig);
        }
        
        this.emit('circuit:enabled', { agentId, config: finalConfig });
    }

    /**
     * Check if circuit is open for an agent
     */
    public isCircuitOpen(agentId: string): boolean {
        const breaker = this.circuitBreakers.get(agentId);
        if (!breaker) return false;
        
        // Check if we should transition to half-open
        if (breaker.status === 'open' && breaker.nextAttempt) {
            if (new Date() >= breaker.nextAttempt) {
                this.transitionToHalfOpen(agentId);
                return false; // Allow one attempt
            }
        }
        
        return breaker.status === 'open';
    }

    /**
     * Record a failure for circuit breaker
     */
    public recordFailure(agentId: string, error?: Error): void {
        const breaker = this.circuitBreakers.get(agentId);
        if (!breaker) return;
        
        const config = this.circuitBreakerConfigs.get(agentId) || this.circuitConfig;
        
        breaker.failures++;
        breaker.lastFailureTime = new Date();
        
        // Check if we should open the circuit
        if (breaker.status === 'closed' || breaker.status === 'half-open') {
            if (breaker.failures >= config.failureThreshold) {
                this.openCircuit(agentId);
            }
        }
        
        // If half-open, immediately go back to open
        if (breaker.status === 'half-open') {
            this.openCircuit(agentId);
        }
        
        this.emit('circuit:failure', { 
            agentId, 
            failures: breaker.failures,
            error: error?.message 
        });
    }

    /**
     * Record a success for circuit breaker
     */
    public recordSuccess(agentId: string): void {
        const breaker = this.circuitBreakers.get(agentId);
        if (!breaker) return;
        
        const config = this.circuitBreakerConfigs.get(agentId) || this.circuitConfig;
        
        breaker.successes++;
        breaker.lastSuccessTime = new Date();
        
        // If half-open and enough successes, close the circuit
        if (breaker.status === 'half-open') {
            if (breaker.successes >= config.successThreshold) {
                this.closeCircuit(agentId);
            }
        }
        
        // Reset failure count on success in closed state
        if (breaker.status === 'closed') {
            breaker.failures = 0;
        }
        
        this.emit('circuit:success', { 
            agentId, 
            successes: breaker.successes 
        });
    }

    /**
     * Get circuit breaker status for an agent
     */
    public getCircuitStatus(agentId: string): CircuitBreakerState | null {
        return this.circuitBreakers.get(agentId) || null;
    }

    /**
     * Get all circuit breaker statuses
     */
    public getAllCircuitStatuses(): Map<string, CircuitBreakerState> {
        return new Map(this.circuitBreakers);
    }

    /**
     * Reset circuit breaker for an agent
     */
    public resetCircuitBreaker(agentId: string): void {
        const breaker = this.circuitBreakers.get(agentId);
        if (breaker) {
            breaker.status = 'closed';
            breaker.failures = 0;
            breaker.successes = 0;
            breaker.lastFailureTime = undefined;
            breaker.lastSuccessTime = undefined;
            breaker.nextAttempt = undefined;
            
            this.emit('circuit:reset', { agentId });
        }
    }

    // ================================
    // Private Routing Methods
    // ================================

    private async routeTaskRequest(message: A2AMessage): Promise<A2AResponse> {
        const task = message.payload as TaskDefinition;

        // If message has a specific target (not 'auto' or 'broadcast'), route directly
        if (message.to && message.to !== 'broadcast' && message.to !== 'auto') {
            return this.routeToSpecificAgent(message);
        }

        // If no capability specified and not auto, treat as generic message
        if (!task.requiredCapability && message.to !== 'auto') {
            return this.routeGenericMessage(message);
        }

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
        const targetAgent = this.registry.getAgentSync(message.to);
        if (!targetAgent) {
            throw new AgentNotFoundError(message.to);
        }

        // CHECK CIRCUIT BREAKER FIRST
        if (this.isCircuitOpen(message.to)) {
            const breaker = this.circuitBreakers.get(message.to);
            const error = `Circuit breaker is open for agent: ${message.to}. Next attempt at: ${breaker?.nextAttempt}`;
            
            this.emit('message.failed', message, error);
            
            return {
                success: false,
                error,
                metadata: {
                    agentId: 'router',
                    timestamp: new Date(),
                    ...(breaker ? { 
                        processingTime: 0,
                        capability: `circuit:${breaker.status}`
                    } : {})
                }
            };
        }

        if (targetAgent.status !== AgentStatus.ONLINE) {
            // Record failure for offline agent
            this.recordFailure(message.to, new Error('Agent offline'));
            throw new A2AError(`Agent is not online: ${message.to}`, 'AGENT_OFFLINE', message.to);
        }

        try {
            const response = await this.queueMessage(message);
            
            // Record success on successful routing
            this.recordSuccess(message.to);
            
            return response;
        } catch (error) {
            // Record failure on error
            this.recordFailure(message.to, error as Error);
            throw error;
        }
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
        const agent = this.registry.getAgentSync(agentId);
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
        this.messageProcessor = setInterval(() => {
            this.processMessageQueues();
        }, 10);
    }

    private setupRoutingTableUpdater(): void {
        // Update routing table every 30 seconds
        this.routingUpdate = setInterval(() => {
            this.updateRoutingTable();
        }, 30000);

        // Initial update
        this.updateRoutingTable();
    }

    private processMessageQueues(): void {
        const priorities: A2APriority[] = ['urgent', 'high', 'normal', 'low'];

        for (const priority of priorities) {
            const queue = this.messageQueue.get(priority);
            if (queue && queue.length > 0) {
                const queuedMessage = queue.shift()!;
                this.processQueuedMessage(queuedMessage);
                break; // Process one message per cycle
            }
        }
    }

    private async processQueuedMessage(queuedMessage: QueuedMessage): Promise<void> {
        const { message } = queuedMessage;
        try {
            // Real implementation would use A2AClient to send the message
            const response = await this.sendViaTransport(message);

            this.activeMessages.delete(queuedMessage.message.id);
            queuedMessage.resolve(response);
            this.emit('message.received', queuedMessage.message);

            // Enregistrer le succès pour le circuit breaker
            if (message.to && message.to !== 'broadcast' && message.to !== 'auto') {
                this.recordSuccess(message.to);
            }

        } catch (error) {
            if (queuedMessage.retries < this.config.maxRetries) {
                queuedMessage.retries++;
                const queue = this.messageQueue.get(queuedMessage.message.priority)!;
                queue.push(queuedMessage);
                this.emit('message.retry', {
                    message,
                    retry: queuedMessage.retries,
                    error: error instanceof Error ? error.message : 'Unknown error'
                });
            } else {
                this.activeMessages.delete(message.id);
                queuedMessage.reject(error instanceof Error ? error : new Error('Message processing failed'));
                this.emit('message.failed', message, error instanceof Error ? error.message : 'Unknown error');

                // Enregistrer l'échec pour le circuit breaker
                if (message.to && message.to !== 'broadcast' && message.to !== 'auto') {
                    this.recordFailure(message.to, error as Error);
                }
            }
        }
    }

    /**
     * Create appropriate message part based on payload type
     */

    private createMessagePart(payload: any): Part {
        if (typeof payload === 'string') {
            return {
                kind: 'text',
                text: payload
            };
        }
        if (typeof payload ==='object' && payload !== null) {
            return {
                kind: 'data',
                data: payload // Utiliser data pour les payloads complexes
            };
        }
        // Pour les types non gérés, renvoyer un texte par défaut
        return {
            kind: 'text',
            text: String(payload)
        };

    }




    /**
     * Send message via real transport
     */
    private async sendViaTransport(message: A2AMessage): Promise<A2AResponse> {
        // Cas spéciaux qui ne nécessitent pas de transport
        if (message.to === 'router' || message.type === A2AMessageType.AGENT_QUERY) {
            return this.handleLocalMessage(message);
        }

        // Broadcast nécessite une logique spéciale
        if (message.to === 'broadcast') {
            return await this.broadcastViaTransport(message);
        }

        // Message point à point - utiliser A2AClient
        const client = this.getOrCreateClient(message.to);

        const messagePart = this.createMessagePart(message.payload);

        // Convertir A2AMessage en format attendu par A2AClient
        const messageParams: MessageSendParameters = {
            message: {
                role: 'agent',
                parts: [messagePart],
                messageId: message.id,
                contextId: message.correlationId,
                kind: 'message',
                metadata: {
                    type: message.type,
                    from: message.from,
                    priority: message.priority,
                    timestamp: message.timestamp.toISOString()
                }
            },
            configuration: {
                timeout: this.config.messageTimeout,
                retries: this.config.maxRetries
            }
        };

        try {
            // Envoyer via A2AClient
            const clientResponse = await client.sendMessage(messageParams);

            // Convertir la réponse A2AClient en A2AResponse
            return this.convertClientResponse(clientResponse, message);

        } catch (error) {
            // Si c'est une erreur A2A, la propager
            if (error instanceof A2AError) {
                throw error;
            }

            // Sinon, wrapper l'erreur
            throw new A2AError(
                `Transport failed to ${message.to}: ${error instanceof Error ? error.message : 'Unknown error'}`,
                'TRANSPORT_ERROR',
                message.to
            );
        }
    }

    /**
     * Convert A2AClient response to A2AResponse
     */
    private convertClientResponse(clientResponse: SendMessageResponse, originalMessage: A2AMessage): A2AResponse {
        const result = clientResponse;

        // Extraire le messageId si disponible
        // let messageId = originalMessage.id;
        // if (result && typeof result === 'object') {
        //     if ('messageId' in result) {
        //         messageId = (result as Message).messageId;
        //     } else if ('id' in result) {
        //         messageId = (result as Task).id;
        //     }
        // }

        return {
            success: true,
            data: result,
            metadata: {
                processingTime: Date.now() - originalMessage.timestamp.getTime(),
                agentId: originalMessage.to,
                timestamp: new Date(),
                // messageId: result?.messageId || originalMessage.id,
                capability: originalMessage.type,
                ...(result && typeof result === 'object' && 'messageId' in result
                    ? { messageId: result.messageId }
                    : { messageId: originalMessage.id })
            }
        };
    }

    /**
     * Handle messages that don't require network transport
     */
    private handleLocalMessage(message: A2AMessage): A2AResponse {
        // Messages destinés au router lui-même
        switch (message.type) {
            case A2AMessageType.HEALTH_CHECK:
                return {
                    success: true,
                    data: {
                        status: 'healthy',
                        stats: this.getRoutingStats(),
                        clientPool: this.clientPool.size,
                        endpoints: this.agentEndpoints.size
                    },
                    metadata: {
                        agentId: 'router',
                        timestamp: new Date()
                    }
                };

            case A2AMessageType.AGENT_QUERY:
                const agents = this.registry.getAllAgents();
                return {
                    success: true,
                    data: agents,
                    metadata: {
                        agentId: 'router',
                        timestamp: new Date(),
                        processingTime: agents.length
                    }
                };

            default:
                return {
                    success: true,
                    data: { message: 'Processed locally by router' },
                    metadata: {
                        agentId: 'router',
                        timestamp: new Date()
                    }
                };
        }
    }

    /**
     * Broadcast message via transport to all agents
     */
    private async broadcastViaTransport(message: A2AMessage): Promise<A2AResponse> {
        const agents = this.registry.getOnlineAgents();
        const responses: any[] = [];
        const errors: any[] = [];

        const broadcastPromises = agents.map(async (agent) => {
            if (agent.agentId === message.from) return; // Ne pas renvoyer à l'expéditeur

            try {
                const client = this.getOrCreateClient(agent.agentId);
                const targetMessage = { ...message, to: agent.agentId };

                const messageParams: MessageSendParameters = {
                    message: {
                        role: 'agent',
                        parts: [{
                            kind: 'text',
                            text: JSON.stringify(targetMessage.payload)
                        }],
                        messageId: `${message.id}-${agent.agentId}`,
                        contextId: message.correlationId,
                        kind: 'message',
                        metadata: {
                            type: message.type,
                            from: message.from,
                            broadcast: true
                        }
                    }
                };

                const response = await client.sendMessage(messageParams);
                responses.push({
                    agentId: agent.agentId,
                    response: response.result
                });

            } catch (error) {
                errors.push({
                    agentId: agent.agentId,
                    error: error instanceof Error ? error.message : 'Unknown error'
                });
            }
        });

        await Promise.allSettled(broadcastPromises);

        return {
            success: errors.length === 0,
            data: {
                responses,
                errors,
                totalAgents: agents.length,
                successful: responses.length,
                failed: errors.length
            },
            metadata: {
                agentId: 'router',
                timestamp: new Date(),
                // broadcast: true
            }
        };
    }

    /**
     * Register agent endpoint
     */
    public registerAgentEndpoint(agentId: string, endpoint: string): void {
        this.agentEndpoints.set(agentId, endpoint);

        // Invalider le client existant pour forcer la recréation
        const existingClient = this.clientPool.get(agentId);
        if (existingClient) {
            existingClient.close();
            this.clientPool.delete(agentId);
        }

        this.emit('endpoint:registered', { agentId, endpoint });
    }



    /**
     * Update agent endpoints from registry
     */
    public async updateEndpointsFromRegistry(): Promise<void> {
        const agents = this.registry.getAllAgents();

        for (const agent of agents) {
            if (agent.metadata.location) {
                this.registerAgentEndpoint(agent.agentId, agent.metadata.location);
            }
        }

        this.emit('endpoints:updated', { count: this.agentEndpoints.size });
    }

    /**
     * Get all registered endpoints
     */
    public getEndpoints(): Map<string, string> {
        return new Map(this.agentEndpoints);
    }

    /**
     * Update routing table
     * based on current topology
     */


    private updateRoutingTable(): void {
        const topology = this.registry.getTopology();
        this.routingTable = topology.messageRoutes;
    }

    // ================================
    // Private Circuit Breaker Methods
    // ================================
    
    private openCircuit(agentId: string): void {
        const breaker = this.circuitBreakers.get(agentId);
        if (!breaker) return;
        
        const config = this.circuitBreakerConfigs.get(agentId) || this.circuitConfig;
        
        breaker.status = 'open';
        breaker.nextAttempt = new Date(Date.now() + config.timeout);
        breaker.successes = 0;
        
        this.emit('circuit:opened', { 
            agentId, 
            nextAttempt: breaker.nextAttempt 
        });
        
        console.warn(`🔴 Circuit breaker OPENED for agent: ${agentId}`);
    }

    private closeCircuit(agentId: string): void {
        const breaker = this.circuitBreakers.get(agentId);
        if (!breaker) return;
        
        breaker.status = 'closed';
        breaker.failures = 0;
        breaker.successes = 0;
        breaker.nextAttempt = undefined;
        
        this.emit('circuit:closed', { agentId });
        
        console.log(`🟢 Circuit breaker CLOSED for agent: ${agentId}`);
    }

    private transitionToHalfOpen(agentId: string): void {
        const breaker = this.circuitBreakers.get(agentId);
        if (!breaker) return;
        
        breaker.status = 'half-open';
        breaker.failures = 0;
        breaker.successes = 0;
        
        this.emit('circuit:half-open', { agentId });
        
        console.log(`🟡 Circuit breaker HALF-OPEN for agent: ${agentId}`);
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

        for (const [agentId,client] of this.clientPool) {
            try {
                client.close();
                this.emit('client:closed', { agentId });
            } catch (error) {
                console.error(`Error closing client for agent ${agentId}:`, error);
            }
        }
        this.clientPool.clear();
        this.agentEndpoints.clear();
        this.messageQueue.clear();
        this.activeMessages.clear();
        this.routingTable.clear();
        this.messageHistory.clear();
        this.circuitBreakers.clear();
        this.circuitBreakerConfigs.clear();

        this.emit('shutdown');
    }
}