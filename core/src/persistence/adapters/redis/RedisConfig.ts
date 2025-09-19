export interface RedisConfig {
    host: string;
    port: number;
    password?: string;
    db?: number;
    keyPrefix?: string;
    enableReadyCheck?: boolean;
    maxRetriesPerRequest?: number;
    retryStrategy?: (times: number) => number | void;
    tls?: {
        enabled: boolean;
        ca?: string;
        cert?: string;
        key?: string;
    };
    cluster?: {
        nodes: Array<{ host: string; port: number }>;
        redisOptions?: any;
    };
    sentinel?: {
        sentinels: Array<{ host: string; port: number }>;
        name: string;
        password?: string;
    };
}