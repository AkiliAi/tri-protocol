/**
 * A2A Protocol Agent Server
 * Agent-to-Agent (A2A) communication server implementation.
 * Serer JSONRPC, GRPC,
 *Fist Core (Alpha) Protocol of the Tri Protocol
 */

// packages/protocols/src/a2a/A2AAgentServer.ts
import express, { Express, Request, Response, NextFunction } from 'express';
import { createServer, Server as HttpServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import cors from 'cors';
import bodyParser from 'body-parser';
import { EventEmitter } from 'eventemitter3';
import { v4 as uuidv4 } from 'uuid';
import {
    AgentCard,
    JSONRPCRequest,
    JSONRPCResponse,
    JSONRPCError,
    A2ARequest,
    SendMessageRequest,
    SendStreamingMessageRequest,
    GetTaskRequest,
    CancelTaskRequest,
    SetTaskPushNotificationConfigRequest,
    GetTaskPushNotificationConfigRequest,
    ListTaskPushNotificationConfigRequest,
    DeleteTaskPushNotificationConfigRequest,
    GetAuthenticatedExtendedCardRequest,
    Task,
    Message,
    TaskStatus,
    TaskStatusUpdateEvent,
    TaskArtifactUpdateEvent,
    SecurityScheme,
    A2AError,
    InvalidRequestError,
    MethodNotFoundError,
    InternalError,
    TransportProtocol
} from './types';
import { SecurityManager } from './SecurityManager';

export interface A2AServerConfig {
    port: number;
    host?: string;
    cors?: cors.CorsOptions;
    maxRequestSize?: string;
    enableHealthCheck?: boolean;
    enableMetrics?: boolean;
    ssl?: {
        cert: string;
        key: string;
        ca?: string;
    };
}

export interface MessageHandler {
    (message: Message, config?: any): Promise<Task | Message>;
}

export interface StreamHandler {
    (message: Message, config?: any, onUpdate?: (event: any) => void): Promise<Task>;
}

export class A2AAgentServer extends EventEmitter {
    private app: Express;
    private httpServer: HttpServer;
    private io?: SocketServer;
    private agentCard: AgentCard;
    private config: A2AServerConfig;
    private securityManager: SecurityManager;

    // Handlers
    private messageHandlers = new Map<string, MessageHandler>();
    private streamHandlers = new Map<string, StreamHandler>();
    private taskHandlers = new Map<string, Function>();

    // Storage
    private tasks = new Map<string, Task>();
    private activeStreams = new Map<string, any>();

    // Metrics
    private metrics = {
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        activeConnections: 0
    };

    constructor(agentCard: AgentCard, config: A2AServerConfig) {
        super();
        this.agentCard = agentCard;
        this.config = config;
        this.app = express();
        this.httpServer = createServer(this.app);
        this.securityManager = new SecurityManager(agentCard.securitySchemes || []);

        this.setupMiddleware();
        this.setupRoutes();
        this.setupWebSocket();
        this.registerDefaultHandlers();
    }

    /**
     * Setup Express middleware
     */
    private setupMiddleware(): void {
        // CORS
        this.app.use(cors(this.config.cors || {
            origin: '*',
            methods: ['GET', 'POST', 'OPTIONS'],
            allowedHeaders: ['Content-Type', 'Authorization', 'X-Agent-Protocol', 'X-Agent-Id']
        }));

        // Body parser
        this.app.use(bodyParser.json({ limit: this.config.maxRequestSize || '10mb' }));
        this.app.use(bodyParser.urlencoded({ extended: true }));

        // Request logging
        this.app.use((req, res, next) => {
            this.metrics.totalRequests++;
            console.log(`[A2A Server] ${req.method} ${req.path}`);
            next();
        });

        // Error handling
        this.app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
            this.metrics.failedRequests++;
            console.error('[A2A Server] Error:', err);
            res.status(500).json({
                jsonrpc: '2.0',
                id: null,
                error: {
                    code: -32603,
                    message: 'Internal server error',
                    data: err.message
                }
            });
        });
    }

    /**
     * Setup HTTP routes
     */
    private setupRoutes(): void {
        // Agent card discovery endpoint
        this.app.get('/.well-known/ai-agent', (req, res) => {
            res.json(this.agentCard);
        });

        // Health check
        if (this.config.enableHealthCheck !== false) {
            this.app.get('/health', (req, res) => {
                res.json({
                    status: 'healthy',
                    agent: this.agentCard.name,
                    uptime: process.uptime(),
                    metrics: this.config.enableMetrics ? this.metrics : undefined
                });
            });
        }

        // JSONRPC endpoint
        this.app.post('/jsonrpc', async (req, res) => {
            try {
                // Validate security
                const authResult = await this.validateSecurity(req);
                if (!authResult.success) {
                    res.status(401).json({
                        jsonrpc: '2.0',
                        id: req.body.id || null,
                        error: {
                            code: -32001,
                            message: 'Unauthorized',
                            data: authResult.error
                        }
                    });
                    return;
                }

                // Handle JSONRPC request
                const request = req.body as A2ARequest;
                const response = await this.handleJSONRPCRequest(request);

                this.metrics.successfulRequests++;
                res.json(response);
            } catch (error) {
                this.metrics.failedRequests++;
                res.json({
                    jsonrpc: '2.0',
                    id: req.body.id || null,
                    error: {
                        code: -32603,
                        message: error instanceof Error ? error.message : 'Internal error'
                    }
                });
            }
        });

        // Metrics endpoint
        if (this.config.enableMetrics) {
            this.app.get('/metrics', (req, res) => {
                res.json({
                    ...this.metrics,
                    timestamp: new Date().toISOString()
                });
            });
        }
    }

    /**
     * Setup WebSocket for streaming
     */
    private setupWebSocket(): void {
        if (!this.agentCard.systemFeatures?.streaming) {
            return;
        }

        this.io = new SocketServer(this.httpServer, {
            cors: this.config.cors || { origin: '*' }
        });

        this.io.on('connection', (socket) => {
            this.metrics.activeConnections++;
            console.log(`[A2A Server] WebSocket client connected: ${socket.id}`);

            socket.on('disconnect', () => {
                this.metrics.activeConnections--;
                // Clean up any active streams
                const streamId = this.activeStreams.get(socket.id);
                if (streamId) {
                    this.activeStreams.delete(socket.id);
                }
                console.log(`[A2A Server] WebSocket client disconnected: ${socket.id}`);
            });

            socket.on('message', async (data) => {
                try {
                    const request = typeof data === 'string' ? JSON.parse(data) : data;

                    if (request.method === 'message/stream') {
                        await this.handleStreamingRequest(socket, request as SendStreamingMessageRequest);
                    } else {
                        const response = await this.handleJSONRPCRequest(request);
                        socket.emit('response', response);
                    }
                } catch (error) {
                    socket.emit('error', {
                        jsonrpc: '2.0',
                        id: null,
                        error: {
                            code: -32700,
                            message: 'Parse error',
                            data: error instanceof Error ? error.message : 'Invalid JSON'
                        }
                    });
                }
            });
        });
    }

    /**
     * Validate security for incoming requests
     */
    private async validateSecurity(req: Request): Promise<{ success: boolean; error?: string }> {
        // If no security schemes, allow all
        if (!this.agentCard.securitySchemes || this.agentCard.securitySchemes.length === 0) {
            return { success: true };
        }

        // Try each security scheme
        for (const scheme of this.agentCard.securitySchemes) {
            try {
                const result = await this.validateScheme(req, scheme);
                if (result.success) {
                    return result;
                }
            } catch (error) {
                // Continue to next scheme
            }
        }

        return { success: false, error: 'No valid authentication found' };
    }

    /**
     * Validate a specific security scheme
     */
    private async validateScheme(req: Request, scheme: SecurityScheme): Promise<{ success: boolean; error?: string }> {
        switch (scheme.type) {
            case 'apiKey':
                const apiKey = scheme.in === 'header'
                    ? req.headers[scheme.name.toLowerCase()]
                    : scheme.in === 'query'
                        ? req.query[scheme.name]
                        : req.cookies?.[scheme.name];

                if (!apiKey) {
                    return { success: false, error: 'API key not provided' };
                }

                // Validate API key (emit event for external validation)
                const validationResult = await new Promise<boolean>((resolve) => {
                    this.emit('security:validateApiKey', apiKey, resolve);
                    // Default to true if no handler after 100ms
                    setTimeout(() => resolve(true), 100);
                });

                return { success: validationResult };

            case 'http':
                const authHeader = req.headers.authorization;
                if (!authHeader) {
                    return { success: false, error: 'Authorization header not provided' };
                }

                const [authScheme, credentials] = authHeader.split(' ');
                if (authScheme.toLowerCase() !== scheme.scheme.toLowerCase()) {
                    return { success: false, error: 'Invalid authentication scheme' };
                }

                // Validate credentials
                const httpValidation = await new Promise<boolean>((resolve) => {
                    this.emit('security:validateHttp', scheme.scheme, credentials, resolve);
                    setTimeout(() => resolve(true), 100);
                });

                return { success: httpValidation };

            // Add other security schemes as needed
            default:
                return { success: false, error: `Unsupported security scheme: ${scheme.type}` };
        }
    }

    /**
     * Handle JSONRPC request
     */
    private async handleJSONRPCRequest(request: A2ARequest): Promise<JSONRPCResponse> {
        try {
            // Validate request format
            if (!request.jsonrpc || request.jsonrpc !== '2.0') {
                throw new InvalidRequestError('Invalid JSONRPC version');
            }

            if (!request.method) {
                throw new InvalidRequestError('Method not specified');
            }

            // Route to appropriate handler
            switch (request.method) {
                case 'message/send':
                    return await this.handleSendMessage(request as SendMessageRequest);

                case 'tasks/get':
                    return await this.handleGetTask(request as GetTaskRequest);

                case 'tasks/cancel':
                    return await this.handleCancelTask(request as CancelTaskRequest);

                case 'tasks/pushNotificationConfig/set':
                    return await this.handleSetPushNotificationConfig(request as SetTaskPushNotificationConfigRequest);

                case 'tasks/pushNotificationConfig/get':
                    return await this.handleGetPushNotificationConfig(request as GetTaskPushNotificationConfigRequest);

                case 'tasks/pushNotificationConfig/list':
                    return await this.handleListPushNotificationConfigs(request as ListTaskPushNotificationConfigRequest);

                case 'tasks/pushNotificationConfig/delete':
                    return await this.handleDeletePushNotificationConfig(request as DeleteTaskPushNotificationConfigRequest);

                case 'agent/getAuthenticatedExtendedCard':
                    return await this.handleGetAuthenticatedExtendedCard(request as GetAuthenticatedExtendedCardRequest);

                default:
                    throw new MethodNotFoundError(`Method not found: ${request.method}`);
            }
        } catch (error) {
            // Convert to JSONRPC error
            if (error instanceof A2AError) {
                return {
                    jsonrpc: '2.0',
                    id: request.id || null,
                    error: {
                        code: typeof error.code === 'number' ? error.code : -32603,
                        message: error.message,
                        data: { agentId: error.agentId, messageId: error.messageId }
                    }
                };
            }

            return {
                jsonrpc: '2.0',
                id: request.id || null,
                error: {
                    code: -32603,
                    message: error instanceof Error ? error.message : 'Internal error'
                }
            };
        }
    }

    /**
     * Handle send message request
     */
    private async handleSendMessage(request: SendMessageRequest): Promise<JSONRPCResponse> {
        const { message, configuration } = request.parameters;

        // Get appropriate handler
        const handler = this.messageHandlers.get('default') || this.messageHandlers.get(message.parts[0]?.kind || 'text');

        if (!handler) {
            throw new InternalError('No message handler registered');
        }

        try {
            const result = await handler(message, configuration);

            // Store task if created
            if (result.kind === 'task') {
                this.tasks.set(result.id, result as Task);
            }

            this.emit('message:received', message);
            this.emit('message:processed', result);

            return {
                jsonrpc: '2.0',
                id: request.id,
                result
            };
        } catch (error) {
            throw new InternalError(`Message processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Handle streaming request via WebSocket
     */
    private async handleStreamingRequest(socket: any, request: SendStreamingMessageRequest): Promise<void> {
        const { message, configuration } = request.parameters;

        // Get stream handler
        const handler = this.streamHandlers.get('default') || this.streamHandlers.get(message.parts[0]?.kind || 'text');

        if (!handler) {
            socket.emit('error', {
                jsonrpc: '2.0',
                id: request.id,
                error: {
                    code: -32603,
                    message: 'No stream handler registered'
                }
            });
            return;
        }

        try {
            // Create task for streaming
            const task: Task = {
                id: uuidv4(),
                contextId: message.contextId || uuidv4(),
                status: {
                    // state: { Submitted: 'submitted' },
                    // timestamp: new Date().toISOString()
                    state: 'submitted' as any,
                    timestamp: new Date().toISOString()
                },
                kind: 'task',
                createdAt: new Date(),
                metadata: {
                    streaming: true,
                    socketId: socket.id
                }
            };

            this.tasks.set(task.id, task);
            this.activeStreams.set(socket.id, task.id);

            // Send initial task response
            socket.emit('response', {
                jsonrpc: '2.0',
                id: request.id,
                result: task
            });

            // Start processing with updates
            const updater = (event: TaskStatusUpdateEvent | TaskArtifactUpdateEvent) => {
                socket.emit('update', {
                    jsonrpc: '2.0',
                    id: request.id,
                    result: event
                });
            };

            const finalTask = await handler(message, configuration, updater);

            // Send final update
            socket.emit('update', {
                jsonrpc: '2.0',
                id: request.id,
                result: {
                    taskId: task.id,
                    contextId: task.contextId,
                    kind: 'status-update',
                    status: finalTask.status,
                    final: true
                }
            });

            this.activeStreams.delete(socket.id);
        } catch (error) {
            socket.emit('error', {
                jsonrpc: '2.0',
                id: request.id,
                error: {
                    code: -32603,
                    message: error instanceof Error ? error.message : 'Stream processing failed'
                }
            });
        }
    }

    /**
     * Handle get task request
     */
    private async handleGetTask(request: GetTaskRequest): Promise<JSONRPCResponse> {
        const { id, historyLengts } = request.parameters;

        const task = this.tasks.get(id);
        if (!task) {
            return {
                jsonrpc: '2.0',
                id: request.id,
                error: {
                    code: -1005,
                    message: `Task not found: ${id}`
                }
            };
        }

        // Limit history if requested
        let result = { ...task };
        if (historyLengts !== undefined && task.history) {
            result.history = task.history.slice(-historyLengts);
        }

        return {
            jsonrpc: '2.0',
            id: request.id,
            result
        };
    }

    /**
     * Handle cancel task request
     */
    private async handleCancelTask(request: CancelTaskRequest): Promise<JSONRPCResponse> {
        const { id } = request.params;

        const task = this.tasks.get(id);
        if (!task) {
            return {
                jsonrpc: '2.0',
                id: request.id,
                error: {
                    code: -1005,
                    message: `Task not found: ${id}`
                }
            };
        }

        // Check if task can be cancelled
        const currentState = Object.keys(task.status.state)[0];
        if (['completed', 'failed', 'cancelled'].includes(currentState)) {
            return {
                jsonrpc: '2.0',
                id: request.id,
                error: {
                    code: -1006,
                    message: `Task cannot be cancelled in state: ${currentState}`
                }
            };
        }

        // Cancel task
        task.status = {
            // state: { Cancelled: 'cancelled' },
            // timestamp: new Date().toISOString()
            state: 'Cancelled' as any,
            timestamp: new Date().toISOString()
        };

        this.emit('task:cancelled', task);

        return {
            jsonrpc: '2.0',
            id: request.id,
            result: task
        };
    }

    /**
     * Handle get authenticated extended card
     */
    private async handleGetAuthenticatedExtendedCard(request: GetAuthenticatedExtendedCardRequest): Promise<JSONRPCResponse> {
        if (!this.agentCard.supportsAuthenticatedExtendedCard) {
            return {
                jsonrpc: '2.0',
                id: request.id,
                error: {
                    code: -1011,
                    message: 'Authenticated extended card not configured'
                }
            };
        }

        // Return extended card (could include additional authenticated fields)
        const extendedCard = {
            ...this.agentCard,
            authenticated: true,
            extendedMetadata: {
                serverTime: new Date().toISOString(),
                capabilities: Array.from(this.messageHandlers.keys())
            }
        };

        return {
            jsonrpc: '2.0',
            id: request.id,
            result: extendedCard
        };
    }

    // Push notification handlers (simplified for now)
    private async handleSetPushNotificationConfig(request: SetTaskPushNotificationConfigRequest): Promise<JSONRPCResponse> {
        // Implementation depends on your push notification system
        return {
            jsonrpc: '2.0',
            id: request.id,
            result: request.params
        };
    }

    private async handleGetPushNotificationConfig(request: GetTaskPushNotificationConfigRequest): Promise<JSONRPCResponse> {
        return {
            jsonrpc: '2.0',
            id: request.id,
            error: {
                code: -1007,
                message: 'Push notifications not supported'
            }
        };
    }

    private async handleListPushNotificationConfigs(request: ListTaskPushNotificationConfigRequest): Promise<JSONRPCResponse> {
        return {
            jsonrpc: '2.0',
            id: request.id,
            result: []
        };
    }

    private async handleDeletePushNotificationConfig(request: DeleteTaskPushNotificationConfigRequest): Promise<JSONRPCResponse> {
        return {
            jsonrpc: '2.0',
            id: request.id,
            result: null
        };
    }

    /**
     * Register default handlers
     */
    private registerDefaultHandlers(): void {
        // Default echo handler
        this.registerMessageHandler('default', async (message: Message) => {
            return {
                role: 'agent' as const,
                parts: [
                    {
                        kind: 'text' as const,
                        text: `Echo: ${message.parts[0]?.kind === 'text' ? message.parts[0].text : 'No text content'}`
                    }
                ],
                messageId: uuidv4(),
                kind: 'message' as const
            };
        });

        // Default stream handler
        this.registerStreamHandler('default', async (message: Message, config: any, onUpdate?: Function) => {
            const task: Task = {
                id: uuidv4(),
                contextId: message.contextId || uuidv4(),
                status: {
                    // state: { Working: 'working' },
                    // timestamp: new Date().toISOString()
                    state: 'Working' as any,
                    timestamp: new Date().toISOString()
                },
                kind: 'task',
                createdAt: new Date()
            };

            // Simulate processing with updates
            if (onUpdate) {
                for (let i = 0; i < 3; i++) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    onUpdate({
                        taskId: task.id,
                        contextId: task.contextId,
                        kind: 'status-update',
                        status: {
                            state: { Working: 'working' },
                            timestamp: new Date().toISOString()
                        },
                        metadata: { progress: (i + 1) * 33 }
                    });
                }
            }

            task.status = {
                // state: { Completed: 'completed' },
                // timestamp: new Date().toISOString()
                state: 'Completed' as any,
                timestamp: new Date().toISOString()
            };

            return task;
        });
    }

    // ================================
    // Public API
    // ================================

    /**
     * Register a message handler
     */
    registerMessageHandler(type: string, handler: MessageHandler): void {
        this.messageHandlers.set(type, handler);
        console.log(`[A2A Server] Registered message handler: ${type}`);
    }

    /**
     * Register a stream handler
     */
    registerStreamHandler(type: string, handler: StreamHandler): void {
        this.streamHandlers.set(type, handler);
        console.log(`[A2A Server] Registered stream handler: ${type}`);
    }

    /**
     * Start the server
     */
    async start(): Promise<void> {
        return new Promise((resolve) => {
            const host = this.config.host || '0.0.0.0';
            this.httpServer.listen(this.config.port, host, () => {
                console.log(`[A2A Server] Started on ${host}:${this.config.port}`);
                console.log(`[A2A Server] Agent: ${this.agentCard.name}`);
                console.log(`[A2A Server] Transport: ${this.agentCard.preferredTransport}`);
                // console.log(`[A2A Server] Streaming: ${this.agentCard.systemFeatures?.includes('streaming') ? 'Enabled' : 'Disabled'}`);
                console.log(`[A2A Server] Streaming: ${this.agentCard.systemFeatures?.streaming ? 'Enabled' : 'Disabled'}`);
                this.emit('server:started', { host, port: this.config.port });
                resolve();
            });
        });
    }

    /**
     * Stop the server
     */
    async stop(): Promise<void> {
        return new Promise((resolve) => {
            // Close WebSocket connections
            if (this.io) {
                this.io.close();
            }

            // Close HTTP server
            this.httpServer.close(() => {
                console.log('[A2A Server] Stopped');
                this.emit('server:stopped');
                resolve();
            });

            // Force close after 5 seconds
            setTimeout(() => {
                this.httpServer.closeAllConnections();
                resolve();
            }, 5000);
        });
    }

    /**
     * Get server metrics
     */
    getMetrics() {
        return {
            ...this.metrics,
            tasksCount: this.tasks.size,
            activeStreams: this.activeStreams.size,
            handlers: {
                message: this.messageHandlers.size,
                stream: this.streamHandlers.size
            }
        };
    }
}