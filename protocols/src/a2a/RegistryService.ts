import { Logger } from '@tri-protocol/logger';
/**
 * A2A Protocol Registry Service
 * Agent-to-Agent (A2A) communication RegistryService implementation.
 * First Core (Alpha) Protocol of the Tri Protocol
 */


// protocols/src/a2a/RegistryService.ts
import express, { Express, Request, Response } from 'express';
import { createServer, Server as HttpServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import { EventEmitter } from 'eventemitter3';
import { v4 as uuidv4 } from 'uuid';
import {
    AgentProfile,
    AgentStatus,
    NetworkTopology,
    AgentCapability
} from './types';

export interface RegistryConfig {
    port: number;
    host?: string;
    corsOrigin?: string;
    healthCheckInterval?: number;
    cleanupInterval?: number;
}

export class RegistryService extends EventEmitter {
    private logger: Logger;
    private agents = new Map<string, AgentProfile>();
    private httpServer: HttpServer;
    private app: Express;
    private io: SocketServer;
    private config: RegistryConfig;
    private healthCheckInterval?: NodeJS.Timeout;
    private cleanupInterval?: NodeJS.Timeout;

    constructor(config: RegistryConfig) {
        super();
        this.config = config;
        this.logger = Logger.getLogger('RegistryService').child({
            port: config.port,
            host: config.host || 'localhost'
        });
        this.app = express();
        this.httpServer = createServer(this.app);
        this.io = new SocketServer(this.httpServer, {
            cors: {
                origin: config.corsOrigin || '*',
                methods: ['GET', 'POST']
            }
        });

        this.setupMiddleware();
        this.setupHTTPEndpoints();
        this.setupWebSocketBroadcast();
        this.setupHealthChecks();
    }

    private setupMiddleware(): void {
        this.app.use(express.json());
        this.app.use(express.urlencoded({ extended: true }));
    }

    private setupHTTPEndpoints(): void {
        // Register agent
        this.app.post('/api/registry/register', async (req: Request, res: Response) => {
            try {
                const profile = req.body as AgentProfile;
                const result = await this.registerAgent(profile);

                if (result.success) {
                    this.broadcastTopologyUpdate();
                    res.json({
                        success: true,
                        agentId: profile.agentId,
                        message: 'Agent registered successfully'
                    });
                } else {
                    res.status(400).json({
                        success: false,
                        error: result.error
                    });
                }
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error instanceof Error ? error.message : 'Registration failed'
                });
            }
        });

        // Discover agents
        this.app.get('/api/registry/discover', async (req: Request, res: Response) => {
            const agents = this.getActiveAgents();
            res.json({
                agents,
                count: agents.length,
                timestamp: new Date()
            });
        });

        // Get specific agent
        this.app.get('/api/registry/agents/:agentId', (req: Request, res: Response) => {
            const agent = this.agents.get(req.params.agentId);
            if (agent) {
                res.json(agent);
            } else {
                res.status(404).json({ error: 'Agent not found' });
            }
        });

        // Update agent status
        this.app.put('/api/registry/agents/:agentId/status', (req: Request, res: Response) => {
            const { status } = req.body;
            const agent = this.agents.get(req.params.agentId);

            if (agent) {
                agent.status = status;
                agent.lastSeen = new Date();
                this.broadcastTopologyUpdate();
                res.json({ success: true });
            } else {
                res.status(404).json({ error: 'Agent not found' });
            }
        });

        // Unregister agent
        this.app.delete('/api/registry/agents/:agentId', (req: Request, res: Response) => {
            const agentId = req.params.agentId;
            if (this.agents.delete(agentId)) {
                this.broadcastTopologyUpdate();
                res.json({ success: true, message: 'Agent unregistered' });
            } else {
                res.status(404).json({ error: 'Agent not found' });
            }
        });

        // Health check endpoint
        this.app.get('/health', (req: Request, res: Response) => {
            res.json({
                status: 'healthy',
                agents: this.agents.size,
                uptime: process.uptime()
            });
        });
    }

    private setupWebSocketBroadcast(): void {
        this.io.on('connection', (socket) => {
            this.logger.info(`📡 Client connected: ${socket.id}`);

            // Send current topology
            socket.emit('topology', this.getTopology());

            // Handle heartbeat
            socket.on('heartbeat', (agentId: string) => {
                this.updateLastSeen(agentId);
                socket.emit('heartbeat:ack', { agentId, timestamp: new Date() });
            });

            // Handle agent registration via WebSocket
            socket.on('register', async (profile: AgentProfile) => {
                const result = await this.registerAgent(profile);
                socket.emit('register:result', result);

                if (result.success) {
                    this.broadcastTopologyUpdate();
                }
            });

            // Handle discovery request
            socket.on('discover', () => {
                socket.emit('agents', this.getActiveAgents());
            });

            socket.on('disconnect', () => {
                this.logger.info(`📡 Client disconnected: ${socket.id}`);
            });
        });
    }

    private setupHealthChecks(): void {
        const interval = this.config.healthCheckInterval || 30000; // 30 seconds

        this.healthCheckInterval = setInterval(() => {
            this.performHealthChecks();
        }, interval);

        // Cleanup interval
        const cleanupInterval = this.config.cleanupInterval || 60000; // 1 minute
        this.cleanupInterval = setInterval(() => {
            this.cleanupInactiveAgents();
        }, cleanupInterval);
    }

    private performHealthChecks(): void {
        const now = Date.now();
        const timeout = 120000; // 2 minutes

        for (const [agentId, agent] of this.agents) {
            const lastSeenMs = agent.lastSeen.getTime();
            if (now - lastSeenMs > timeout && agent.status === AgentStatus.ONLINE) {
                agent.status = AgentStatus.OFFLINE;
                this.emit('agent:offline', agentId);
                this.logger.info(`⚠️ Agent ${agentId} marked as offline`);
            }
        }
    }

    private cleanupInactiveAgents(): void {
        const now = Date.now();
        const cleanupTimeout = 300000; // 5 minutes
        const toRemove: string[] = [];

        for (const [agentId, agent] of this.agents) {
            if (agent.status === AgentStatus.OFFLINE) {
                const lastSeenMs = agent.lastSeen.getTime();
                if (now - lastSeenMs > cleanupTimeout) {
                    toRemove.push(agentId);
                }
            }
        }

        for (const agentId of toRemove) {
            this.agents.delete(agentId);
            this.logger.info(`🗑️ Removed inactive agent: ${agentId}`);
        }

        if (toRemove.length > 0) {
            this.broadcastTopologyUpdate();
        }
    }

    async registerAgent(profile: AgentProfile): Promise<{ success: boolean; error?: string }> {
        // Validate profile
        if (!profile.agentId || !profile.agentType || !profile.capabilities) {
            return { success: false, error: 'Invalid agent profile' };
        }

        // Check if already registered
        if (this.agents.has(profile.agentId)) {
            // Update existing
            const existing = this.agents.get(profile.agentId)!;
            Object.assign(existing, profile);
            existing.lastSeen = new Date();
            return { success: true };
        }

        // Add new agent
        profile.lastSeen = new Date();
        profile.status = profile.status || AgentStatus.ONLINE;
        this.agents.set(profile.agentId, profile);

        this.emit('agent:registered', profile);
        this.logger.info(`✅ Registered agent: ${profile.agentId}`);

        return { success: true };
    }

    broadcastTopologyUpdate(): void {
        const topology = this.getTopology();
        this.io.emit('topology:update', topology);
        this.emit('topology:changed', topology);
    }

    getActiveAgents(): AgentProfile[] {
        return Array.from(this.agents.values()).filter(
            agent => agent.status === AgentStatus.ONLINE
        );
    }

    getAllAgents(): AgentProfile[] {
        return Array.from(this.agents.values());
    }

    getTopology(): NetworkTopology {
        const connections = new Map<string, string[]>();
        const messageRoutes = new Map<string, any[]>();

        // Build connection map
        for (const [agentId, agent] of this.agents) {
            connections.set(agentId, []);

            // Add routes for capabilities
            for (const cap of agent.capabilities) {
                if (!messageRoutes.has(cap.name)) {
                    messageRoutes.set(cap.name, []);
                }
                messageRoutes.get(cap.name)!.push({
                    agentId,
                    capability: cap.name,
                    reliability: cap.reliability,
                    cost: cap.cost
                });
            }
        }

        return {
            agents: new Map(this.agents),
            connections,
            messageRoutes,
            lastUpdated: new Date()
        };
    }

    updateLastSeen(agentId: string): void {
        const agent = this.agents.get(agentId);
        if (agent) {
            agent.lastSeen = new Date();
            if (agent.status === AgentStatus.OFFLINE) {
                agent.status = AgentStatus.ONLINE;
                this.emit('agent:online', agentId);
                this.broadcastTopologyUpdate();
            }
        }
    }

    async start(): Promise<void> {
        return new Promise((resolve) => {
            const port = this.config.port;
            const host = this.config.host || '0.0.0.0';

            this.httpServer.listen(port, host, () => {
                this.logger.info(`🌐 Registry Service running on http://${host}:${port}`);
                this.logger.info(`📡 WebSocket available on ws://${host}:${port}`);
                this.emit('started', { port, host });
                resolve();
            });
        });
    }

    async stop(): Promise<void> {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
        }
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }

        this.io.close();

        return new Promise((resolve) => {
            this.httpServer.close(() => {
                this.logger.info('🛑 Registry Service stopped');
                this.emit('stopped');
                resolve();
            });
        });
    }
}