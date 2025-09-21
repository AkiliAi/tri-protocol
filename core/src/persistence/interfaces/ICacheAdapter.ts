export interface ICacheAdapter {
    get<T = any>(key: string): Promise<T | null>;
    set(key: string, value: any): Promise<void>;
    setex(key: string, value: any, ttl: number): Promise<void>;
    del(...keys: string[]): Promise<number>;
    exists(key: string): Promise<boolean>;
    expire(key: string, ttl: number): Promise<boolean>;
    ttl(key: string): Promise<number>;
    keys(pattern: string): Promise<string[]>;

    hget(key: string, field: string): Promise<any>;
    hset(key: string, field: string, value: any): Promise<void>;
    hmset(key: string, fields: Record<string, any>): Promise<void>;
    hgetall(key: string): Promise<Record<string, any>>;
    hdel(key: string, ...fields: string[]): Promise<number>;

    sadd(key: string, ...members: any[]): Promise<number>;
    smembers(key: string): Promise<any[]>;
    srem(key: string, ...members: any[]): Promise<number>;
    sismember(key: string, member: any): Promise<boolean>;

    zadd(key: string, score: number, member: any): Promise<number>;
    zrange(key: string, start: number, stop: number): Promise<any[]>;
    zremrangebyscore(key: string, min: number | string, max: number | string): Promise<number>;
    zcard(key: string): Promise<number>;

    publish(channel: string, message: any): Promise<void>;
    subscribe(channel: string, handler: (message: any) => void): Promise<void>;
    unsubscribe(channel: string): Promise<void>;

    rateLimit(key: string, limit: number, window: number): Promise<boolean>;
    increment(key: string): Promise<number>;
    decrement(key: string): Promise<number>;
}