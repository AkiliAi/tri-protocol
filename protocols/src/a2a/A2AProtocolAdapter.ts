//protocols/src/a2a/A2AProtocolAdapter.ts
/**
 * A2A Protocol Adapter -
 * Agent-to-Agent communication protocol adapter for the Tri Protocol.
 * This adapter allows agents to communicate with each other using the Tri Protocol.
 * Fist Core (Alpha) Protocol of the Tri Protocol
 */
// packages/protocols/src/a2a/A2AProtocolAdapter.ts
import { EventEmitter } from 'eventemitter3';
import axios ,{AxiosInstance} from 'axios';
import { v4 as uuidv4 } from 'uuid';
import WebSocket from 'ws';
import jwt from 'jsonwebtoken';

import {
    AgentCard,
    AgentProfile,
    A2AMessage,
    A2AMessageType,
    Task,
    TaskStatus,
    Message,
    Part,
    JSONRPCRequest,
    JSONRPCResponse,
    JSONRPCError,
    SendMessageRequest,
    SendStreamingMessageRequest,
    GetTaskRequest,
    CancelTaskRequest,
    SetTaskPushNotificationConfigRequest,
    GetTaskPushNotificationConfigRequest,
    ListTaskPushNotificationConfigRequest,
    DeleteTaskPushNotificationConfigRequest,
    GetAuthenticatedExtendedCardRequest,
    TaskPushNotificationConfig,
    PushNotificationConfig,
    SecurityScheme,
    A2AError,
    AgentNotFoundError,
    MessageSendConfiguration,
    SendMessageSuccessResponse,
    GetTaskSuccessResponse,
    CancelTaskSuccessResponse,
    TaskStatusUpdateEvent,
    TaskArtifactUpdateEvent,
    SendStreamingMessageSuccessResponse,
    TransportProtocol,
    AgentCapability,
    AgentStatus,
    CapabilityQuery,
    CapabilityMatch, A2AResponse
} from './types';
import {SecurityManager}  from "./SecurityManager";
import {A2AAgentRegistry} from "./A2AAgentRegistry";
import {MessageRouter} from "./MessageRouter";



export interface A2AProtocolConfig {
    agentCard: AgentCard;
    security?:{
        defaultScheme?: string;
        credentials?: Record<string, any>
    };
    network?: {
        timeout?: number;
        retries?: number;
        discoveryInterval?: number;
    };
}
export class A2AProtocolAdapter extends EventEmitter {
    private router: MessageRouter;


    private agentCard: AgentCard;
    private config: A2AProtocolConfig;
    private httpClient:AxiosInstance;
    // private httpClient = axios.create();
    private registry: A2AAgentRegistry;
    private securityManager: SecurityManager;
    private wsConnections: Map<string, WebSocket> = new Map();
    private registeredAgents: Map<string, AgentProfile> = new Map();
    private tasks: Map<string, Task> = new Map();
    private pushNotificationConfigs: Map<string, TaskPushNotificationConfig> = new Map();

    constructor(config: A2AProtocolConfig) {
        super();
        this.config = config;
        this.agentCard = config.agentCard;
        this.securityManager = new SecurityManager(this.agentCard.securitySchemes || []);
        this.httpClient = this.createHttpClient();
        this.registry = new A2AAgentRegistry({
            networkName: config.agentCard.name,
            broadcastInterval: config.network?.discoveryInterval || 30000,
            messageTimeout: config.network?.timeout || 30000,
            maxRetries: config.network?.retries || 3,
            enableHealthMonitoring: true,
            enableWorkflowEngine: true,
            logLevel: 'info',
            performance: {
                maxConcurrentTasks: 100,
                queueSize: 1000,
                routingAlgorithm: 'best-match'
            }
        });
        this.router = new MessageRouter(this.registry, {
            networkName: config.agentCard.name,
            broadcastInterval: config.network?.discoveryInterval || 30000,
            messageTimeout: config.network?.timeout || 30000,
            maxRetries: config.network?.retries || 3,
            enableHealthMonitoring: true,
            enableWorkflowEngine: true,
            logLevel: 'info',
            performance: {
                maxConcurrentTasks: 100,
                queueSize: 1000,
                routingAlgorithm: 'best-match'
            }

        });
        // this.router = new MessageRouter(this.registry, this.config)


        this.setupRegistryEvents();
        this.setupDiscovery();
        this.setupRouterEvents();

    }

    /**
     * Setup router event handlers
     */
    private setupRouterEvents(): void {
        this.router.on('message.sent', (message) => {
            this.emit('message:sent', message);
        });

        this.router.on('message.failed', (message, error) => {
            this.emit('message:failed', { message, error });
        });
    }

    /**
     * Route message through router
     */
    async routeMessage(message: A2AMessage): Promise<A2AResponse> {
        return this.router.routeMessage(message);
    }

    /**
     * Broadcast message
     */
    async broadcastMessage(message: A2AMessage): Promise<A2AResponse[]> {
        return this.router.broadcastMessage(message);
    }

    // Initialize transport based on agent card
    private setupTransport(): void {
        switch (this.agentCard.preferredTransport) {
            case TransportProtocol.JSONRPC:
                this.setupJSONRPC();
                break;
            case TransportProtocol.GRPC:
                this.setupGRPC();
                break;
            case TransportProtocol.HTTP_JSON:
                this.setupHTTPJSON();
                break;
            default:
                this.setupCustomTransport(this.agentCard.preferredTransport);
        }
    }

    // JSONRPC implementation
    private setupJSONRPC(): void {
        // Setup JSONRPC server/client
        console.log('🔌 Setting up JSONRPC transport');
    }
    // GRPC implementation
    private setupGRPC(): void {
        // Setup GRPC server/client
        console.log('🔌 Setting up GRPC transport');
    }
    // HTTP JSON implementation
    private setupHTTPJSON(): void {
        // Setup HTTP JSON server/client
        console.log('🔌 Setting up HTTP JSON transport');
    }
    // Custom transport implementation
    private setupCustomTransport(protocol: string): void {
        // Setup custom transport based on protocol
        console.log(`🔌 Setting up custom transport for ${protocol}`);
    }

    // Send JSONRPC message
    async sendJSONRPCMessage(
        agentUrl: string,
        request: JSONRPCRequest
    ): Promise<JSONRPCResponse> {
        try {
            const response = await this.httpClient.post(agentUrl, request, {
                headers: {
                    'Content-Type': 'application/json',
                    'X-Agent-Protocol': 'a2a/1.0'
                }
            });

            return response.data as JSONRPCResponse;
        } catch (error) {
            throw new A2AError(
                'JSONRPC request failed',
                'RPC_FAILED',
                this.agentCard.name
            );
        }
    }

    // ================================
    // Core JSONRPC Handlers
    // ================================

    /**
     * Send a message to another agent
     */
    async sendMessage(
        targetAgentId: string,
        message: Message,
        config?: MessageSendConfiguration
    ): Promise<Task | Message> {
        const targetAgent = await this.getAgent(targetAgentId);

        const request: SendMessageRequest = {
            jsonrpc: '2.0',
            id: uuidv4(),
            method: 'message/send',
            parameters: {
                message,
                configuration: config
            }
        };

        const response = await this.sendSecureJSONRPC(
            targetAgent.metadata.location,
            request
        );

        if ('error' in response && response.error) {
            throw this.handleJSONRPCError(response.error);
        }

        const result = (response as SendMessageSuccessResponse).result;

        // Store task if created
        if (result.kind === 'task') {
            this.tasks.set(result.id, result as Task);
        }

        this.emit('message:sent', { to: targetAgentId, message, result });
        return result;
    }

    /**
     * Stream a message for real-time updates
     */
    async streamMessage(
        targetAgentId: string,
        message: Message,
        config?: MessageSendConfiguration,
        onUpdate?: (event: TaskStatusUpdateEvent | TaskArtifactUpdateEvent) => void
    ): Promise<Task> {
        const targetAgent = await this.getAgent(targetAgentId);

        const request: SendStreamingMessageRequest = {
            jsonrpc: '2.0',
            id: uuidv4(),
            method: 'message/stream',
            parameters: {
                message,
                configuration: config
            }
        };

        return new Promise((resolve, reject) => {
            const ws = this.getOrCreateWebSocket(targetAgent.metadata.location);
            let task: Task | null = null;

            const handleMessage = (data: string) => {
                try {
                    const response = JSON.parse(data) as SendStreamingMessageSuccessResponse;

                    if ('error' in response && response.error) {
                        reject(this.handleJSONRPCError(response.error));
                        return;
                    }

                    const result = response.result;

                    if (result.kind === 'task' && !task) {
                        task = result as Task;
                        this.tasks.set(task.id, task);
                        resolve(task);
                    } else if (result.kind === 'status-update' || result.kind === 'artifact-update') {
                        if (onUpdate) {
                            onUpdate(result as TaskStatusUpdateEvent | TaskArtifactUpdateEvent);
                        }
                        this.emit('task:update', result);

                        // Update task status if we have it
                        if (task && result.kind === 'status-update') {
                            task.status = (result as TaskStatusUpdateEvent).status;
                            if ((result as TaskStatusUpdateEvent).final) {
                                ws.off('message', handleMessage);
                            }
                        }
                    }
                } catch (error) {
                    reject(error);
                }
            };

            ws.on('message', handleMessage);
            ws.send(JSON.stringify(request));
        });
    }

    /**
     * Get task details
     */
    async getTask(taskId: string, historyLength?: number): Promise<Task> {
        const task = this.tasks.get(taskId);
        const agentId = task ? await this.findAgentForTask(taskId) : null;

        if (!agentId) {
            throw new A2AError('Task not found', 'TASK_NOT_FOUND');
        }

        const targetAgent = await this.getAgent(agentId);

        const request: GetTaskRequest = {
            jsonrpc: '2.0',
            id: uuidv4(),
            method: 'tasks/get',
            parameters: {
                id: taskId,
                historyLengts: historyLength // Note: typo in original spec
            }
        };

        const response = await this.sendSecureJSONRPC(
            targetAgent.metadata.location,
            request
        );

        if ('error' in response && response.error) {
            throw this.handleJSONRPCError(response.error);
        }

        const updatedTask = (response as GetTaskSuccessResponse).result;
        this.tasks.set(taskId, updatedTask);

        return updatedTask;
    }

    /**
     * Cancel a task
     */
    async cancelTask(taskId: string): Promise<Task> {
        const agentId = await this.findAgentForTask(taskId);
        if (!agentId) {
            throw new A2AError('Task not found', 'TASK_NOT_FOUND');
        }

        const targetAgent = await this.getAgent(agentId);

        const request: CancelTaskRequest = {
            jsonrpc: '2.0',
            id: uuidv4(),
            method: 'tasks/cancel',
            params: {
                id: taskId
            }
        };

        const response = await this.sendSecureJSONRPC(
            targetAgent.metadata.location,
            request
        );

        if ('error' in response && response.error) {
            throw this.handleJSONRPCError(response.error);
        }

        const cancelledTask = (response as CancelTaskSuccessResponse).result;
        this.tasks.set(taskId, cancelledTask);
        this.emit('task:cancelled', cancelledTask);

        return cancelledTask;
    }

    /**
     * Set push notification configuration for a task
     */
    async setTaskPushNotificationConfig(
        taskId: string,
        pushConfig: PushNotificationConfig
    ): Promise<TaskPushNotificationConfig> {
        const agentId = await this.findAgentForTask(taskId);
        if (!agentId) {
            throw new A2AError('Task not found', 'TASK_NOT_FOUND');
        }

        const targetAgent = await this.getAgent(agentId);

        const config: TaskPushNotificationConfig = {
            taskId,
            pushNotificationConfig: pushConfig
        };

        const request: SetTaskPushNotificationConfigRequest = {
            jsonrpc: '2.0',
            id: uuidv4(),
            method: 'tasks/pushNotificationConfig/set',
            params: config
        };

        const response = await this.sendSecureJSONRPC(
            targetAgent.metadata.location,
            request
        );

        if ('error' in response && response.error) {
            throw this.handleJSONRPCError(response.error);
        }

        // Store config locally
        if (!this.pushNotificationConfigs.has(taskId)) {
            this.pushNotificationConfigs.set(taskId, {
                taskId,
                pushNotificationConfig: pushConfig
            });
        }

        return response.result as TaskPushNotificationConfig;
    }

    /**
     * Get push notification configuration
     */
    async getTaskPushNotificationConfig(
        taskId: string,
        configId?: string
    ): Promise<TaskPushNotificationConfig> {
        const agentId = await this.findAgentForTask(taskId);
        if (!agentId) {
            throw new A2AError('Task not found', 'TASK_NOT_FOUND');
        }

        const targetAgent = await this.getAgent(agentId);

        const request: GetTaskPushNotificationConfigRequest = {
            jsonrpc: '2.0',
            id: uuidv4(),
            method: 'tasks/pushNotificationConfig/get',
            params: configId ?
                { id: taskId, pushNotificationConfigId: configId } :
                { id: taskId }
        };

        const response = await this.sendSecureJSONRPC(
            targetAgent.metadata.location,
            request
        );

        if ('error' in response && response.error) {
            throw this.handleJSONRPCError(response.error);
        }

        return response.result as TaskPushNotificationConfig;
    }

    /**
     * List push notification configurations for a task
     */
    async listTaskPushNotificationConfigs(taskId: string): Promise<TaskPushNotificationConfig[]> {
        const agentId = await this.findAgentForTask(taskId);
        if (!agentId) {
            throw new A2AError('Task not found', 'TASK_NOT_FOUND');
        }

        const targetAgent = await this.getAgent(agentId);

        const request: ListTaskPushNotificationConfigRequest = {
            jsonrpc: '2.0',
            id: uuidv4(),
            method: 'tasks/pushNotificationConfig/list',
            params: { id: taskId }
        };

        const response = await this.sendSecureJSONRPC(
            targetAgent.metadata.location,
            request
        );

        if ('error' in response && response.error) {
            throw this.handleJSONRPCError(response.error);
        }

        return response.result as TaskPushNotificationConfig[];
    }

    /**
     * Delete push notification configuration
     */
    async deleteTaskPushNotificationConfig(
        taskId: string,
        configId: string
    ): Promise<void> {
        const agentId = await this.findAgentForTask(taskId);
        if (!agentId) {
            throw new A2AError('Task not found', 'TASK_NOT_FOUND');
        }

        const targetAgent = await this.getAgent(agentId);

        const request: DeleteTaskPushNotificationConfigRequest = {
            jsonrpc: '2.0',
            id: uuidv4(),
            method: 'tasks/pushNotificationConfig/delete',
            params: {
                id: taskId,
                pushNotificationConfigId: configId
            }
        };

        const response = await this.sendSecureJSONRPC(
            targetAgent.metadata.location,
            request
        );

        if ('error' in response && response.error) {
            throw this.handleJSONRPCError(response.error);
        }

        // Remove from local storage
        const config = this.pushNotificationConfigs.get(taskId);
        if (config && config.pushNotificationConfig.id === configId) {
            this.pushNotificationConfigs.delete(taskId);
        }
    }

    /**
     * Get authenticated extended card
     */
    async getAuthenticatedExtendedCard(agentId: string): Promise<AgentCard> {
        const targetAgent = await this.getAgent(agentId);

        const request: GetAuthenticatedExtendedCardRequest = {
            jsonrpc: '2.0',
            id: uuidv4(),
            method: 'agent/getAuthenticatedExtendedCard'
        };

        const response = await this.sendSecureJSONRPC(
            targetAgent.metadata.location,
            request
        );

        if ('error' in response && response.error) {
            throw this.handleJSONRPCError(response.error);
        }

        return response.result as AgentCard;
    }

    // ================================
    // Security Implementation
    // ================================

    /**
     * Send JSONRPC request with security
     */
    private async sendSecureJSONRPC(
        url: string,
        request: JSONRPCRequest
    ): Promise<JSONRPCResponse> {
        try {
            // Get security headers based on agent's security scheme
            const headers = await this.securityManager.getAuthHeaders(
                this.config.security?.defaultScheme || 'none',
                this.config.security?.credentials
            );

            const response = await this.httpClient.post(url, request, {
                headers: {
                    ...headers,
                    'Content-Type': 'application/json',
                    'X-Agent-Protocol': 'a2a/1.0',
                    'X-Agent-Id': this.agentCard.name
                }
            });

            return response.data as JSONRPCResponse;
        } catch (error) {
            if (axios.isAxiosError(error) && error.response?.data) {
                return error.response.data as JSONRPCResponse;
            }
            throw new A2AError(
                'JSONRPC request failed',
                'RPC_FAILED',
                this.agentCard.name
            );
        }
    }

    /**
     * Create HTTP client with interceptors
     */
    private createHttpClient(): AxiosInstance {
        const client = axios.create({
            timeout: this.config.network?.timeout || 30000,
            validateStatus: () => true // Handle all status codes
        });

        // Add retry logic
        client.interceptors.response.use(
            response => response,
            async error => {
                const config = error.config;
                config.retryCount = config.retryCount || 0;

                if (config.retryCount < (this.config.network?.retries || 3)) {
                    config.retryCount++;
                    return client(config);
                }

                return Promise.reject(error);
            }
        );

        return client;
    }

    // ================================
    // WebSocket Management
    // ================================

    /**
     * Get or create WebSocket connection
     */
    private getOrCreateWebSocket(url: string): WebSocket {
        const wsUrl = url.replace(/^http/, 'ws');

        if (!this.wsConnections.has(wsUrl)) {
            const ws = new WebSocket(wsUrl);

            ws.on('open', () => {
                this.emit('ws:connected', wsUrl);
                console.log(`🔌 WebSocket connected to ${wsUrl}`);
            });

            ws.on('error', (error) => {
                this.emit('ws:error', { url: wsUrl, error });
                console.error(`❌ WebSocket error for ${wsUrl}:`, error);
            });

            ws.on('close', () => {
                this.wsConnections.delete(wsUrl);
                this.emit('ws:disconnected', wsUrl);
                console.log(`🔌 WebSocket disconnected from ${wsUrl}`);
            });

            this.wsConnections.set(wsUrl, ws);
        }

        return this.wsConnections.get(wsUrl)!;
    }



    // ================================
    // Agent Discovery & Management
    // ================================

    /**
     * Setup periodic discovery
     */
    private setupDiscovery(): void {
        const interval = this.config.network?.discoveryInterval || 30000;

        // Initial discovery
        this.discoverAgents();

        // Periodic discovery
        setInterval(() => {
            this.discoverAgents();
        }, interval);
    }

    /**
     * Discover agents in the network
     */
    async discoverAgents(): Promise<void> {
        try {
            // Broadcast discovery message
            const discoveryMessage: A2AMessage = {
                id: uuidv4(),
                role: 'agent',
                from: this.agentCard.name,
                to: 'broadcast',
                type: A2AMessageType.AGENT_QUERY,
                payload: {
                    query: 'discover',
                    agentCard: this.agentCard
                },
                timestamp: new Date(),
                priority: 'low'
            };

            // In a real implementation, this would use multicast or a discovery service
            this.emit('discovery:sent', discoveryMessage);

        } catch (error) {
            this.emit('discovery:error', error);
        }
    }

    /**
     * Setup registry event handlers
     */
    private setupRegistryEvents(): void {
        this.registry.on('agent:registered', (agent) => {
            this.emit('agent:registered', agent);
        });

        this.registry.on('agent:unregistered', (agentId) => {
            this.emit('agent:unregistered', agentId);
        });

        this.registry.on('network:topology:changed', (topology) => {
            this.emit('network:topology:changed', topology);
        });
    }

    /**
     * Find agents by capability
     */
    async findAgentsByCapability(capability: string): Promise<AgentProfile[]> {
        return this.registry.findByCapability(capability);
    }

    /**
     * Get network statistics
     */
    getNetworkStats() {
        return this.registry.getNetworkStats();
    }



    /**
     * Register discovered agent
     * Register agent - délègue au registry
     */
    // registerAgent(profile: AgentProfile): void {
    //     const agentId = profile.agentId;
    //     this.registeredAgents.set(profile.agentId, profile);
    //     this.emit('agent:registered', profile);
    //     console.log(`✅ Registered agent: ${profile.agentId}`);
    //     console.log(`[A2A Registry] Agent registered: ${agentId} with ${profile.capabilities.length} capabilities`);
    //     this.updateTopology();
    // }
    registerAgent(profile: AgentProfile): void {
        this.registry.registerAgent(profile);
    }

    /**
     * Unregister an agent from the network
     */
    // async unregisterAgent(agentId: string): Promise<void> {
    //     const agent = this.agents.get(agentId);
    //     if (!agent) {
    //         return; // Agent not found, silently ignore
    //     }
    //
    //     // Remove from indices
    //     await this.removeAgentFromIndices(agentId);
    //
    //     // Remove agent
    //     this.agents.delete(agentId);
    //     this.capabilities.delete(agentId);
    //
    //     // Update topology
    //     this.updateTopology();
    //
    //     // Emit events
    //     this.emit('agent.unregistered', agentId);
    //     this.emit('network.topology.changed', this.getTopology());
    //
    //     console.log(`[A2A Registry] Agent unregistered: ${agentId}`);
    // }
    async unregisterAgent(agentId: string): Promise<void> {
        await this.registry.unregisterAgent(agentId);
    }

    /**
     * Get agent by ID
     */
    private async getAgent(agentId: string): Promise<AgentProfile> {
        const agent = this.registry.getAgent(agentId);
        if (!agent) {
            throw new AgentNotFoundError(agentId);
        }
        return agent;
    }

    /**
     * Get all capabilities for an agent
     */
    async queryCapabilities(query: CapabilityQuery): Promise<CapabilityMatch[]> {
        return this.registry.queryCapabilities(query);
    }

    /**
     * Find which agent is handling a task
     */
    private async findAgentForTask(taskId: string): Promise<string | null> {
        // In a real implementation, this would query a task registry
        // For now, check our local task storage
        const task = this.tasks.get(taskId);
        if (task && task.metadata?.agentId) {
            return task.metadata.agentId as string;
        }

        // Query all known agents
        for (const [agentId, agent] of this.registeredAgents) {
            try {
                await this.getTask(taskId);
                return agentId;
            } catch (error) {
                // Continue searching
            }
        }

        return null;
    }

    // ================================
    // Error Handling
    // ================================

    /**
     * Handle JSONRPC errors
     */
    private handleJSONRPCError(error: JSONRPCError | A2AError): Error {
        if ('code' in error && 'message' in error) {
            // Map JSONRPC error codes to A2A errors
            switch (error.code) {
                case -1000: // Parse error
                case -1001: // Invalid request
                case -1002: // Method not found
                case -1003: // Invalid params
                case -1004: // Internal error
                    return new A2AError(error.message, error.code.toString());

                case -1005: // Task not found
                    return new A2AError(error.message, 'TASK_NOT_FOUND');

                case -1006: // Task not cancelable
                    return new A2AError(error.message, 'TASK_NOT_CANCELABLE');

                case -32007: // Push notification not supported
                    return new A2AError(error.message, 'PUSH_NOT_SUPPORTED');

                default:
                    return new A2AError(error.message, 'UNKNOWN_ERROR');
            }
        }

        return error as Error;
    }

    // ================================
    // Public API
    // ================================

    /**
     * Get registered agents
     */
    getRegisteredAgents(): AgentProfile[] {
        return Array.from(this.registeredAgents.values());
    }

    /**
     * Get active tasks
     */
    getActiveTasks(): Task[] {
        return Array.from(this.tasks.values());
    }

    /**
     * Close all connections
     */
    async shutdown(): Promise<void> {
        // Close all WebSocket connections
        for (const [url, ws] of this.wsConnections) {
            ws.close();
        }
        this.wsConnections.clear();

        // Clear registrations
        this.registeredAgents.clear();
        this.tasks.clear();
        this.pushNotificationConfigs.clear();

        this.emit('shutdown');
    }
}