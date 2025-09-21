export interface QueryCriteria {
    filters?: Record<string, any>;
    nested?: boolean;
    aggregation?: any[];
    semantic?: string;
    limit?: number;
    offset?: number;
    sort?: Record<string, 'asc' | 'desc'>;
}

export interface SearchOptions {
    limit?: number;
    threshold?: number;
    filter?: any;
    includeDistance?: boolean;
}

export interface SearchResult {
    id: string;
    score: number;
    payload: any;
    distance?: number;
}

export interface PersistenceAdapter {
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    isConnected(): boolean;

    save(collection: string, id: string, data: any): Promise<void>;
    load(collection: string, id: string): Promise<any>;
    delete(collection: string, id: string): Promise<void>;
    exists(collection: string, id: string): Promise<boolean>;
    update<T>(collection: string, id: string, data: Partial<T>): Promise<void>;


    find(collection: string, criteria: QueryCriteria): Promise<any[]>;
    findOne(collection: string, criteria: QueryCriteria): Promise<any>;
    count(collection: string, criteria: QueryCriteria): Promise<number>;

    saveMany<T>(collection: string, items: Array<{id: string, data: T}>): Promise<void>;
    deleteMany(collection: string, ids: string[]): Promise<number>;

    createIndex(collection: string, fields: string[], options?: any): Promise<void>;
    dropIndex(collection: string, indexName: string): Promise<void>;

    transaction?<T>(fn: () => Promise<T>): Promise<T>;
}

export interface TransactionOptions {
    isolationLevel?: 'read_uncommitted' | 'read_committed' | 'repeatable_read' | 'serializable';
    timeout?: number;
}

export type EntityType = 'workflow' | 'agent' | 'execution' | 'message' | 'agent_memory' | 'task';

export interface IPersistenceStrategy {
    save(type: EntityType, data: any): Promise<void>;
    load(type: EntityType, id: string): Promise<any>;
    delete(type: EntityType, id: string): Promise<void>;
    search(query: any): Promise<SearchResult[]>;
}