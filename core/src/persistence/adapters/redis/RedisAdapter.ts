import Redis, { Redis as RedisClient, Cluster } from 'ioredis';
import { ICacheAdapter } from '../../interfaces/ICacheAdapter';
import { RedisConfig } from './RedisConfig';
import { Logger } from '@tri-protocol/logger';
export class RedisAdapter implements ICacheAdapter {
    private client: RedisClient | Cluster;
    private subscriber: RedisClient;
    private publisher: RedisClient;
    private logger: Logger;
    private config: RedisConfig;
    private connected: boolean = false;
    private subscriptions: Map<string, (message: any) => void> = new Map();

    constructor(config: RedisConfig) {
        this.config = config;
        this.logger = Logger.getLogger('RedisAdapter');

        if (config.cluster) {
            this.client = new Redis.Cluster(config.cluster.nodes, {
                redisOptions: this.buildRedisOptions(config)
            });
        } else if (config.sentinel) {
            this.client = new Redis({
                sentinels: config.sentinel.sentinels,
                name: config.sentinel.name,
                password: config.sentinel.password,
                ...this.buildRedisOptions(config)
            });
        } else {
            this.client = new Redis(this.buildRedisOptions(config));
        }

        this.subscriber = this.createRedisClient();
        this.publisher = this.createRedisClient();

        this.setupEventHandlers();
    }

    private buildRedisOptions(config: RedisConfig): any {
        const options: any = {
            host: config.host,
            port: config.port,
            password: config.password,
            db: config.db || 0,
            keyPrefix: config.keyPrefix,
            enableReadyCheck: config.enableReadyCheck !== false,
            maxRetriesPerRequest: config.maxRetriesPerRequest || 3,
            retryStrategy: config.retryStrategy || ((times: number) => {
                const delay = Math.min(times * 50, 2000);
                return delay;
            })
        };

        if (config.tls?.enabled) {
            options.tls = {
                ca: config.tls.ca,
                cert: config.tls.cert,
                key: config.tls.key
            };
        }

        return options;
    }

    private createRedisClient(): RedisClient {
        if (this.config.cluster) {
            throw new Error('Pub/Sub not supported with cluster mode. Use Redis Streams instead.');
        }

        return new Redis(this.buildRedisOptions(this.config));
    }

    private setupEventHandlers(): void {
        this.client.on('connect', () => {
            this.logger.info('Redis connected');
            this.connected = true;
        });

        this.client.on('error', (error) => {
            this.logger.error('Redis error:', error);
        });

        this.client.on('close', () => {
            this.logger.info('Redis connection closed');
            this.connected = false;
        });

        this.subscriber.on('message', (channel, message) => {
            const handler = this.subscriptions.get(channel);
            if (handler) {
                try {
                    const parsed = JSON.parse(message);
                    handler(parsed);
                } catch (error) {
                    this.logger.error(`Failed to parse message from channel ${channel}:`, error);
                }
            }
        });
    }

    async connect(): Promise<void> {
        if (this.connected) {
            return;
        }

        // ioredis connects automatically unless lazyConnect is true
        // Just verify connection with ping
        try {
            await this.client.ping();
            this.connected = true;
        } catch (error) {
            // If not connected, try to connect
            await this.client.connect();
            await this.subscriber.connect();
            await this.publisher.connect();
            this.connected = true;
        }
    }

    async disconnect(): Promise<void> {
        if (!this.connected) {
            return;
        }

        await this.client.quit();
        await this.subscriber.quit();
        await this.publisher.quit();
        this.connected = false;
    }

    isConnected(): boolean {
        return this.connected;
    }

    async get<T = any>(key: string): Promise<T | null> {
        try {
            const value = await this.client.get(key);
            return value ? JSON.parse(value) : null;
        } catch (error) {
            this.logger.error(`Failed to get key ${key}:`, error);
            return null;
        }
    }

    async set(key: string, value: any): Promise<void> {
        try {
            await this.client.set(key, JSON.stringify(value));
        } catch (error) {
            this.logger.error(`Failed to set key ${key}:`, error);
            throw error;
        }
    }

    async setex(key: string, value: any, ttl: number): Promise<void> {
        try {
            await this.client.setex(key, ttl, JSON.stringify(value));
        } catch (error) {
            this.logger.error(`Failed to setex key ${key}:`, error);
            throw error;
        }
    }

    async del(...keys: string[]): Promise<number> {
        try {
            return await this.client.del(...keys);
        } catch (error) {
            this.logger.error('Failed to delete keys:', error);
            throw error;
        }
    }

    async exists(key: string): Promise<boolean> {
        try {
            const result = await this.client.exists(key);
            return result === 1;
        } catch (error) {
            this.logger.error(`Failed to check existence of key ${key}:`, error);
            return false;
        }
    }

    async expire(key: string, ttl: number): Promise<boolean> {
        try {
            const result = await this.client.expire(key, ttl);
            return result === 1;
        } catch (error) {
            this.logger.error(`Failed to set expiry for key ${key}:`, error);
            return false;
        }
    }

    async ttl(key: string): Promise<number> {
        try {
            return await this.client.ttl(key);
        } catch (error) {
            this.logger.error(`Failed to get TTL for key ${key}:`, error);
            return -1;
        }
    }

    async keys(pattern: string): Promise<string[]> {
        try {
            return await this.client.keys(pattern);
        } catch (error) {
            this.logger.error(`Failed to get keys with pattern ${pattern}:`, error);
            return [];
        }
    }

    async hget(key: string, field: string): Promise<any> {
        try {
            const value = await this.client.hget(key, field);
            return value ? JSON.parse(value) : null;
        } catch (error) {
            this.logger.error(`Failed to hget ${key}:${field}:`, error);
            return null;
        }
    }

    async hset(key: string, field: string, value: any): Promise<void> {
        try {
            await this.client.hset(key, field, JSON.stringify(value));
        } catch (error) {
            this.logger.error(`Failed to hset ${key}:${field}:`, error);
            throw error;
        }
    }

    async hmset(key: string, fields: Record<string, any>): Promise<void> {
        try {
            const serialized: Record<string, string> = {};
            for (const [field, value] of Object.entries(fields)) {
                serialized[field] = JSON.stringify(value);
            }
            await this.client.hmset(key, serialized);
        } catch (error) {
            this.logger.error(`Failed to hmset ${key}:`, error);
            throw error;
        }
    }

    async hgetall(key: string): Promise<Record<string, any>> {
        try {
            const raw = await this.client.hgetall(key);
            const result: Record<string, any> = {};

            for (const [field, value] of Object.entries(raw)) {
                try {
                    result[field] = JSON.parse(value);
                } catch {
                    result[field] = value;
                }
            }

            return result;
        } catch (error) {
            this.logger.error(`Failed to hgetall ${key}:`, error);
            return {};
        }
    }

    async hdel(key: string, ...fields: string[]): Promise<number> {
        try {
            return await this.client.hdel(key, ...fields);
        } catch (error) {
            this.logger.error(`Failed to hdel ${key}:`, error);
            throw error;
        }
    }

    async sadd(key: string, ...members: any[]): Promise<number> {
        try {
            const serialized = members.map(m => JSON.stringify(m));
            return await this.client.sadd(key, ...serialized);
        } catch (error) {
            this.logger.error(`Failed to sadd ${key}:`, error);
            throw error;
        }
    }

    async smembers(key: string): Promise<any[]> {
        try {
            const raw = await this.client.smembers(key);
            return raw.map(value => {
                try {
                    return JSON.parse(value);
                } catch {
                    return value;
                }
            });
        } catch (error) {
            this.logger.error(`Failed to smembers ${key}:`, error);
            return [];
        }
    }

    async srem(key: string, ...members: any[]): Promise<number> {
        try {
            const serialized = members.map(m => JSON.stringify(m));
            return await this.client.srem(key, ...serialized);
        } catch (error) {
            this.logger.error(`Failed to srem ${key}:`, error);
            throw error;
        }
    }

    async sismember(key: string, member: any): Promise<boolean> {
        try {
            const result = await this.client.sismember(key, JSON.stringify(member));
            return result === 1;
        } catch (error) {
            this.logger.error(`Failed to sismember ${key}:`, error);
            return false;
        }
    }

    async zadd(key: string, score: number, member: any): Promise<number> {
        try {
            return await this.client.zadd(key, score, JSON.stringify(member));
        } catch (error) {
            this.logger.error(`Failed to zadd ${key}:`, error);
            throw error;
        }
    }

    async zrange(key: string, start: number, stop: number): Promise<any[]> {
        try {
            const raw = await this.client.zrange(key, start, stop);
            return raw.map(value => {
                try {
                    return JSON.parse(value);
                } catch {
                    return value;
                }
            });
        } catch (error) {
            this.logger.error(`Failed to zrange ${key}:`, error);
            return [];
        }
    }

    async zremrangebyscore(key: string, min: number | string, max: number | string): Promise<number> {
        try {
            return await this.client.zremrangebyscore(key, min, max);
        } catch (error) {
            this.logger.error(`Failed to zremrangebyscore ${key}:`, error);
            throw error;
        }
    }

    async zcard(key: string): Promise<number> {
        try {
            return await this.client.zcard(key);
        } catch (error) {
            this.logger.error(`Failed to zcard ${key}:`, error);
            return 0;
        }
    }

    async publish(channel: string, message: any): Promise<void> {
        try {
            await this.publisher.publish(channel, JSON.stringify(message));
        } catch (error) {
            this.logger.error(`Failed to publish to channel ${channel}:`, error);
            throw error;
        }
    }

    async subscribe(channel: string, handler: (message: any) => void): Promise<void> {
        try {
            await this.subscriber.subscribe(channel);
            this.subscriptions.set(channel, handler);
        } catch (error) {
            this.logger.error(`Failed to subscribe to channel ${channel}:`, error);
            throw error;
        }
    }

    async unsubscribe(channel: string): Promise<void> {
        try {
            await this.subscriber.unsubscribe(channel);
            this.subscriptions.delete(channel);
        } catch (error) {
            this.logger.error(`Failed to unsubscribe from channel ${channel}:`, error);
            throw error;
        }
    }

    async rateLimit(key: string, limit: number, window: number): Promise<boolean> {
        const now = Date.now();
        const windowStart = now - window;

        const pipeline = this.client.pipeline();

        pipeline.zremrangebyscore(key, '-inf', windowStart.toString());
        pipeline.zcard(key);
        pipeline.zadd(key, now, `${now}-${Math.random()}`);
        pipeline.expire(key, Math.ceil(window / 1000));

        const results = await pipeline.exec();

        if (!results) {
            return false;
        }

        const count = results[1]?.[1] as number;

        if (count < limit) {
            return true;
        }

        await this.client.zremrangebyscore(key, now.toString(), now.toString());
        return false;
    }

    async increment(key: string): Promise<number> {
        try {
            return await this.client.incr(key);
        } catch (error) {
            this.logger.error(`Failed to increment ${key}:`, error);
            throw error;
        }
    }

    async decrement(key: string): Promise<number> {
        try {
            return await this.client.decr(key);
        } catch (error) {
            this.logger.error(`Failed to decrement ${key}:`, error);
            throw error;
        }
    }

    async flushdb(): Promise<void> {
        try {
            await this.client.flushdb();
        } catch (error) {
            this.logger.error('Failed to flush database:', error);
            throw error;
        }
    }

    async ping(): Promise<boolean> {
        try {
            const result = await this.client.ping();
            return result === 'PONG';
        } catch (error) {
            this.logger.error('Failed to ping Redis:', error);
            return false;
        }
    }
}