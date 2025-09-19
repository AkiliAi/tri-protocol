import { EventEmitter } from 'eventemitter3';
import { Logger } from '@tri-protocol/logger';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { MongoClient } from 'mongodb';

export interface HealthCheckConfig {
    enabled: boolean;
    interval?: number; // in milliseconds
    timeout?: number; // in milliseconds
    services: {
        redis?: {
            host: string;
            port: number;
            password?: string;
        };
        postgres?: {
            host: string;
            port: number;
            user: string;
            password: string;
            database: string;
        };
        mongodb?: {
            uri: string;
        };
        qdrant?: {
            url: string;
        };
    };
}

export interface ServiceHealth {
    name: string;
    status: 'healthy' | 'unhealthy' | 'degraded' | 'unknown';
    message?: string;
    latency?: number;
    lastCheck: Date;
    metadata?: Record<string, any>;
}

export interface SystemHealth {
    status: 'healthy' | 'unhealthy' | 'degraded';
    services: ServiceHealth[];
    timestamp: Date;
    uptime: number;
}

export class HealthCheckService extends EventEmitter {
    private logger: Logger;
    private config: HealthCheckConfig;
    private checkInterval?: NodeJS.Timeout;
    private startTime: Date;
    private lastHealthStatus: SystemHealth;

    constructor(config: HealthCheckConfig) {
        super();
        this.config = config;
        this.logger = Logger.getLogger('HealthCheckService');
        this.startTime = new Date();
        this.lastHealthStatus = {
            status: 'unknown' as any,
            services: [],
            timestamp: new Date(),
            uptime: 0
        };
    }

    async start(): Promise<void> {
        if (!this.config.enabled) {
            this.logger.info('Health check service is disabled');
            return;
        }

        this.logger.info('Starting health check service...');

        // Perform initial health check
        await this.performHealthCheck();

        // Set up periodic checks
        const interval = this.config.interval || 30000; // Default 30 seconds
        this.checkInterval = setInterval(() => {
            this.performHealthCheck().catch(error => {
                this.logger.error('Health check failed:', error);
            });
        }, interval);

        this.emit('started');
    }

    async stop(): Promise<void> {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = undefined;
        }
        this.emit('stopped');
    }

    async performHealthCheck(): Promise<SystemHealth> {
        const startTime = Date.now();
        const services: ServiceHealth[] = [];

        // Check Redis
        if (this.config.services.redis) {
            services.push(await this.checkRedis());
        }

        // Check PostgreSQL
        if (this.config.services.postgres) {
            services.push(await this.checkPostgres());
        }

        // Check MongoDB
        if (this.config.services.mongodb) {
            services.push(await this.checkMongoDB());
        }

        // Check Qdrant
        if (this.config.services.qdrant) {
            services.push(await this.checkQdrant());
        }

        // Determine overall system health
        const unhealthyCount = services.filter(s => s.status === 'unhealthy').length;
        const degradedCount = services.filter(s => s.status === 'degraded').length;

        let systemStatus: 'healthy' | 'unhealthy' | 'degraded';
        if (unhealthyCount > 0) {
            systemStatus = 'unhealthy';
        } else if (degradedCount > 0) {
            systemStatus = 'degraded';
        } else {
            systemStatus = 'healthy';
        }

        const health: SystemHealth = {
            status: systemStatus,
            services,
            timestamp: new Date(),
            uptime: Date.now() - this.startTime.getTime()
        };

        this.lastHealthStatus = health;

        const checkDuration = Date.now() - startTime;
        this.logger.debug(`Health check completed in ${checkDuration}ms - Status: ${systemStatus}`);

        this.emit('health:checked', health);

        if (systemStatus === 'unhealthy') {
            this.emit('health:unhealthy', health);
        } else if (systemStatus === 'degraded') {
            this.emit('health:degraded', health);
        }

        return health;
    }

    private async checkRedis(): Promise<ServiceHealth> {
        const startTime = Date.now();
        let client: Redis | null = null;

        try {
            client = new Redis({
                host: this.config.services.redis!.host,
                port: this.config.services.redis!.port,
                password: this.config.services.redis!.password,
                connectTimeout: this.config.timeout || 5000,
                lazyConnect: true
            });

            await client.connect();
            const pong = await client.ping();
            const info = await client.info('server');
            await client.quit();

            const version = info.match(/redis_version:([^\r\n]+)/)?.[1];
            const latency = Date.now() - startTime;

            return {
                name: 'Redis',
                status: 'healthy',
                message: `Redis ${version} is responding`,
                latency,
                lastCheck: new Date(),
                metadata: { version }
            };

        } catch (error: any) {
            if (client) {
                try {
                    await client.quit();
                } catch {}
            }

            return {
                name: 'Redis',
                status: 'unhealthy',
                message: `Redis connection failed: ${error.message}`,
                lastCheck: new Date()
            };
        }
    }

    private async checkPostgres(): Promise<ServiceHealth> {
        const startTime = Date.now();
        let pool: Pool | null = null;

        try {
            pool = new Pool({
                host: this.config.services.postgres!.host,
                port: this.config.services.postgres!.port,
                user: this.config.services.postgres!.user,
                password: this.config.services.postgres!.password,
                database: this.config.services.postgres!.database,
                connectionTimeoutMillis: this.config.timeout || 5000,
                max: 1
            });

            const client = await pool.connect();
            const result = await client.query('SELECT version(), current_database()');
            const vectorResult = await client.query(
                "SELECT COUNT(*) FROM pg_extension WHERE extname = 'vector'"
            );
            client.release();
            await pool.end();

            const version = result.rows[0].version.split(' ')[1];
            const hasVector = vectorResult.rows[0].count > 0;
            const latency = Date.now() - startTime;

            return {
                name: 'PostgreSQL',
                status: 'healthy',
                message: `PostgreSQL ${version} is responding`,
                latency,
                lastCheck: new Date(),
                metadata: {
                    version,
                    pgvector: hasVector,
                    database: result.rows[0].current_database
                }
            };

        } catch (error: any) {
            if (pool) {
                try {
                    await pool.end();
                } catch {}
            }

            return {
                name: 'PostgreSQL',
                status: 'unhealthy',
                message: `PostgreSQL connection failed: ${error.message}`,
                lastCheck: new Date()
            };
        }
    }

    private async checkMongoDB(): Promise<ServiceHealth> {
        const startTime = Date.now();
        let client: MongoClient | null = null;

        try {
            client = new MongoClient(this.config.services.mongodb!.uri, {
                serverSelectionTimeoutMS: this.config.timeout || 5000,
                connectTimeoutMS: this.config.timeout || 5000
            });

            await client.connect();
            const admin = client.db().admin();
            const info = await admin.serverStatus();
            await client.close();

            const latency = Date.now() - startTime;

            return {
                name: 'MongoDB',
                status: 'healthy',
                message: `MongoDB ${info.version} is responding`,
                latency,
                lastCheck: new Date(),
                metadata: {
                    version: info.version,
                    storageEngine: info.storageEngine?.name
                }
            };

        } catch (error: any) {
            if (client) {
                try {
                    await client.close();
                } catch {}
            }

            return {
                name: 'MongoDB',
                status: 'unhealthy',
                message: `MongoDB connection failed: ${error.message}`,
                lastCheck: new Date()
            };
        }
    }

    private async checkQdrant(): Promise<ServiceHealth> {
        const startTime = Date.now();

        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), this.config.timeout || 5000);

            const response = await fetch(`${this.config.services.qdrant!.url}/`, {
                signal: controller.signal
            });

            clearTimeout(timeout);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json() as any;
            const latency = Date.now() - startTime;

            return {
                name: 'Qdrant',
                status: 'healthy',
                message: `Qdrant ${data.version || 'unknown'} is responding`,
                latency,
                lastCheck: new Date(),
                metadata: {
                    version: data.version,
                    title: data.title
                }
            };

        } catch (error: any) {
            return {
                name: 'Qdrant',
                status: 'unhealthy',
                message: `Qdrant connection failed: ${error.message}`,
                lastCheck: new Date()
            };
        }
    }

    getLastHealth(): SystemHealth {
        return this.lastHealthStatus;
    }

    isHealthy(): boolean {
        return this.lastHealthStatus.status === 'healthy';
    }

    getServiceHealth(serviceName: string): ServiceHealth | undefined {
        return this.lastHealthStatus.services.find(s =>
            s.name.toLowerCase() === serviceName.toLowerCase()
        );
    }

    async checkSingleService(serviceName: string): Promise<ServiceHealth> {
        switch (serviceName.toLowerCase()) {
            case 'redis':
                return this.checkRedis();
            case 'postgres':
            case 'postgresql':
                return this.checkPostgres();
            case 'mongodb':
            case 'mongo':
                return this.checkMongoDB();
            case 'qdrant':
                return this.checkQdrant();
            default:
                return {
                    name: serviceName,
                    status: 'unknown',
                    message: 'Unknown service',
                    lastCheck: new Date()
                };
        }
    }
}

export default HealthCheckService;