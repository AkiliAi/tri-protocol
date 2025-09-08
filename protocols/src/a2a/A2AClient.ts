// protocols/src/a2a/A2AClient.ts
/**
 * A2A Protocol Agent Client
 * Agent-to-Agent (A2A) communication client implementation.
 * First Core (Alpha) Protocol of the Tri Protocol
 */

import axios, { AxiosInstance } from 'axios';
import { EventEmitter } from 'eventemitter3';
import { Logger } from '../../../logger';
import {
    AgentCard,
    MessageSendParameters,
    SendMessageResponse,
    Message,
    Task,
    TaskArtifactUpdateEvent,
    TaskPushNotificationConfig,
    SetTaskPushNotificationConfigResponse,
    TaskIdParameters,
    GetTaskPushNotificationConfigResponse,
    TaskQueryParameters,
    GetTaskResponse,
    CancelTaskResponse,
    JSONRPCResponse,
    JSONRPCErrorResponse,
    TaskStatusUpdateEvent,
    JSONRPCRequest,
    A2AError,
    DeleteTaskPushNotificationConfigParams,
    DeleteTaskPushNotificationConfigResponse,
    GetAuthenticatedExtendedCardResponse,
    SecurityCredentials,
    ListTaskPushNotificationConfigSuccessResponse
} from "./types";

type A2AStreamEventData = Message | Task | TaskStatusUpdateEvent | TaskArtifactUpdateEvent;

export interface A2AClientConfig {
    timeout?: number;
    headers?: Record<string, string>;
    credentials?: SecurityCredentials;
    retries?: number;
}

export class A2AClient extends EventEmitter {
    private logger: Logger;
    private agentBaseUrl: string;
    private agentCardPath: string;
    private agentCardPromise?: Promise<AgentCard>;
    private requestIdCounter: number = 0;
    private serviceEndpoint?: string;
    private httpClient: AxiosInstance;
    private config: A2AClientConfig;

    constructor(agentBaseUrl: string, agentCardPath: string = '/.well-known/ai-agent', config: A2AClientConfig = {}) {
        super();
        this.agentBaseUrl = agentBaseUrl.replace(/\/$/, ''); // Remove trailing slash
        this.agentCardPath = agentCardPath;
        this.config = config;
        
        // Initialize logger
        this.logger = Logger.getLogger('A2AClient').child({
            agentUrl: agentBaseUrl,
            timeout: config.timeout || 30000
        });
        
        this.logger.debug('Initializing A2A Client', {
            agentCardPath,
            retries: config.retries
        });

        this.httpClient = axios.create({
            baseURL: this.agentBaseUrl,
            timeout: config.timeout || 30000,
            headers: {
                'Content-Type': 'application/json',
                'X-Agent-Protocol': 'a2a/1.0',
                ...config.headers
            }
        });

        // Add retry interceptor if configured
        if (config.retries) {
            this.setupRetryInterceptor();
        }
    }

    /**
     * Setup retry interceptor for failed requests
     */
    private setupRetryInterceptor(): void {
        this.httpClient.interceptors.response.use(
            response => response,
            async error => {
                const config = error.config;
                config.retryCount = config.retryCount || 0;

                if (config.retryCount < (this.config.retries || 3)) {
                    config.retryCount++;
                    this.logger.debug('Retrying request', {
                        attempt: config.retryCount,
                        maxRetries: this.config.retries || 3,
                        url: config.url
                    });
                    await new Promise(resolve => setTimeout(resolve, 1000 * config.retryCount));
                    return this.httpClient(config);
                }
                
                this.logger.error('Request failed after retries', error, {
                    url: config.url,
                    attempts: config.retryCount
                });
                return Promise.reject(error);
            }
        );
    }

    /**
     * Fetch and cache agent card
     */
    private async fetchAndCacheAgentCard(): Promise<AgentCard> {
        try {
            const response = await this.httpClient.get<AgentCard>(this.agentCardPath);
            const agentCard = response.data;

            // Extract service endpoint
            this.serviceEndpoint = agentCard.url || `${this.agentBaseUrl}/jsonrpc`;

            this.emit('agentCard:fetched', agentCard);
            return agentCard;
        } catch (error) {
            const errorMessage = `Failed to fetch agent card from ${this.agentBaseUrl}${this.agentCardPath}`;
            this.emit('error', new A2AError(errorMessage, 'AGENT_CARD_FETCH_FAILED'));
            throw new A2AError(errorMessage, 'AGENT_CARD_FETCH_FAILED');
        }
    }

    /**
     * Get agent card (with caching)
     */
    async getAgentCard(): Promise<AgentCard> {
        if (!this.agentCardPromise) {
            this.agentCardPromise = this.fetchAndCacheAgentCard();
        }
        return this.agentCardPromise;
    }

    /**
     * Get service endpoint
     */
    private async getServiceEndpoint(): Promise<string> {
        if (!this.serviceEndpoint) {
            await this.getAgentCard();
        }
        return this.serviceEndpoint || `${this.agentBaseUrl}/jsonrpc`;
    }

    /**
     * Generate next request ID
     */
    private getNextRequestId(): string {
        return `${++this.requestIdCounter}`;
    }

    /**
     * Post RPC request
     */
    private async postRpcRequest<T = any>(method: string, params?: any): Promise<T> {
        const endpoint = await this.getServiceEndpoint();
        const request: JSONRPCRequest = {
            jsonrpc: '2.0',
            id: this.getNextRequestId(),
            method,
            parameters: params
        };

        // Auth Header if token is provided
        const headers:any = {};
        if ( this.config.credentials?.token) {
            headers['Authorization'] = `Bearer ${this.config.credentials.token}`;
        }

        try {
            const response = await this.httpClient.post<JSONRPCResponse>(endpoint, request,{headers});

            if (this.isErrorResponse(response.data)) {
                throw new A2AError(
                    response.data.error.message,
                    response.data.error.code,
                    undefined,
                    request.id?.toString()
                );
            }

            return response.data as T;
        } catch (error) {
            if (error instanceof A2AError) {
                throw error;
            }

            throw new A2AError(
                `RPC request failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                'RPC_REQUEST_FAILED',
                undefined,
                request.id?.toString()
            );
        }
    }

    /**
     * Send message
     */
    async sendMessage(params: MessageSendParameters): Promise<SendMessageResponse> {
        const response = await this.postRpcRequest<SendMessageResponse>('message/send', params);
        this.emit('message:sent', params.message);
        return response;
    }

    /**
     * Send message with streaming response
     */
    async *sendMessageStream(params: MessageSendParameters): AsyncGenerator<A2AStreamEventData, void, undefined> {
        const endpoint = await this.getServiceEndpoint();
        const request: JSONRPCRequest = {
            jsonrpc: '2.0',
            id: this.getNextRequestId(),
            method: 'message/stream',
            parameters: params
        };

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'text/event-stream',
                'X-Agent-Protocol': 'a2a/1.0',
                ...this.config.headers
            },
            body: JSON.stringify(request)
        });

        if (!response.ok) {
            throw new A2AError(
                `Stream request failed: ${response.statusText}`,
                'STREAM_REQUEST_FAILED'
            );
        }

        // Parse SSE stream
        yield* this.parseA2ASseStream(response.body!);
    }

    /**
     * Set task push notification configuration
     */
    async setTaskPushNotificationConfig(params: TaskPushNotificationConfig): Promise<SetTaskPushNotificationConfigResponse> {
        return this.postRpcRequest<SetTaskPushNotificationConfigResponse>(
            'tasks/pushNotificationConfig/set',
            params
        );
    }

    /**
     * Get task push notification configuration
     */
    async getTaskPushNotificationConfig(params: TaskIdParameters): Promise<GetTaskPushNotificationConfigResponse> {
        return this.postRpcRequest<GetTaskPushNotificationConfigResponse>(
            'tasks/pushNotificationConfig/get',
            params
        );
    }

    /**
     * List task push notification configurations
     */
    async listTaskPushNotificationConfigs(params: TaskIdParameters): Promise<TaskPushNotificationConfig[]> {
        // const response = await this.postRpcRequest<{ result: TaskPushNotificationConfig[] }>(
        //     'tasks/pushNotificationConfig/list',
        //     params
        // );
        const response = await this.postRpcRequest<ListTaskPushNotificationConfigSuccessResponse>(
            'tasks/pushNotificationConfig/list',
            params
        );
        return response.result;
    }

    /**
     * Delete task push notification configuration
     */
    async deleteTaskPushNotificationConfig(params: DeleteTaskPushNotificationConfigParams): Promise<DeleteTaskPushNotificationConfigResponse> {
        return this.postRpcRequest<DeleteTaskPushNotificationConfigResponse>(
            'tasks/pushNotificationConfig/delete',
            params
        );
    }

    /**
     * Get task
     */
    async getTask(params: TaskQueryParameters): Promise<GetTaskResponse> {
        return this.postRpcRequest<GetTaskResponse>('tasks/get', params);
    }

    /**
     * Cancel task
     */
    async cancelTask(params: TaskIdParameters): Promise<CancelTaskResponse> {
        const response = await this.postRpcRequest<CancelTaskResponse>('tasks/cancel', params);
        this.emit('task:cancelled', params.id);
        return response;
    }

    /**
     * Resubscribe to task updates
     */
    async *resubscribeTask(params: TaskIdParameters): AsyncGenerator<A2AStreamEventData, void, undefined> {
        const endpoint = await this.getServiceEndpoint();
        const request: JSONRPCRequest = {
            jsonrpc: '2.0',
            id: this.getNextRequestId(),
            method: 'tasks/resubscribe',
            parameters: params
        };

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'text/event-stream',
                ...this.config.headers
            },
            body: JSON.stringify(request)
        });

        if (!response.ok) {
            throw new A2AError(
                `Resubscribe request failed: ${response.statusText}`,
                'RESUBSCRIBE_FAILED'
            );
        }

        yield* this.parseA2ASseStream(response.body!);
    }

    /**
     * Get authenticated extended card
     */
    async getAuthenticatedExtendedCard(): Promise<GetAuthenticatedExtendedCardResponse> {
        return this.postRpcRequest<GetAuthenticatedExtendedCardResponse>(
            'agent/getAuthenticatedExtendedCard'
        );
    }

    /**
     * Parse SSE stream
     */
    private async *parseA2ASseStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<A2AStreamEventData, void, undefined> {
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6);
                        if (data === '[DONE]') {
                            return;
                        }

                        try {
                            const eventData = this.processSseEventData(data);
                            if (eventData) {
                                yield eventData;
                                this.emit('stream:data', eventData);
                            }
                        } catch (error) {
                            this.emit('stream:error', error);
                        }
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }
    }


    /**
     * Check if data is a valid A2A stream event
     */

    private isA2AStreamEventData(data: any): data is A2AStreamEventData {
        return data && (
            (data.kind === 'message') ||
            (data.kind === 'task') ||
            (data.kind === 'status-update') ||
            (data.kind === 'artifact-update')
        );
    }

    /**
     * Process SSE event data
     */
    private processSseEventData(data: string): A2AStreamEventData | null {
        try {
            const parsed = JSON.parse(data);

            // Handle JSONRPC response wrapper
            if (parsed.jsonrpc && parsed.result){
                const result = parsed.result;
                if (this.isA2AStreamEventData(result)) {
                    return result;
                }
            }

            // Direct event data
            if (this.isA2AStreamEventData(parsed)) {
                return parsed ;
            }


            return null;
        } catch (error) {
            this.logger.error('Failed to parse SSE data', error as Error, {
                data: data.substring(0, 200) // Log first 200 chars only
            });
            return null;
        }
    }

    /**
     * Check if response is an error
     */
    isErrorResponse(response: JSONRPCResponse): response is JSONRPCErrorResponse {
        return 'error' in response && response.error !== undefined;
    }

    /**
     * Health check
     */
    async healthCheck(): Promise<{ status: string; agent?: string }> {
        try {
            const response = await this.httpClient.get('/health');
            return response.data;
        } catch (error) {
            throw new A2AError('Health check failed', 'HEALTH_CHECK_FAILED');
        }
    }

    /**
     * Get metrics (if enabled)
     */
    async getMetrics(): Promise<any> {
        try {
            const response = await this.httpClient.get('/metrics');
            return response.data;
        } catch (error) {
            throw new A2AError('Metrics not available', 'METRICS_NOT_AVAILABLE');
        }
    }

    /**
     * Close client connections
     */
    close(): void {
        this.emit('client:closing');
        this.removeAllListeners();
    }
}