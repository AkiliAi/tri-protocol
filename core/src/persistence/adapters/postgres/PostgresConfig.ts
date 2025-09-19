export interface PostgresConfig {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
    max?: number;
    idleTimeoutMillis?: number;
    connectionTimeoutMillis?: number;
    ssl?: boolean | {
        rejectUnauthorized?: boolean;
        ca?: string;
        cert?: string;
        key?: string;
    };
    vectorDimension?: number;
    indexMethod?: 'ivfflat' | 'hnsw';
    lists?: number;
    efConstruction?: number;
    m?: number;
}