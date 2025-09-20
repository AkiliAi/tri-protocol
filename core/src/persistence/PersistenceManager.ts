import { EventEmitter } from 'eventemitter3';
// @ts-ignore
import { Logger } from '@tri-protocol/logger';
import EmbeddingService, { EmbeddingConfig } from '../services/embedding/EmbeddingService';
import {
    EntityType,
    IPersistenceStrategy,
    QueryCriteria,
    SearchOptions,
    SearchResult
} from './interfaces/IPersistenceAdapter';
import { ICacheAdapter } from './interfaces/ICacheAdapter';
import { IDocumentAdapter } from './interfaces/IDocumentAdapter';
import { IVectorAdapter, SearchParams, VectorPoint } from './interfaces/IVectorAdapter';
import { IRelationalAdapter } from './interfaces/IRelationalAdapter';

export interface RedisConfig {
    host: string;
    port: number;
    password?: string;
    db?: number;
    keyPrefix?: string;
    enableReadyCheck?: boolean;
    maxRetriesPerRequest?: number;
}

export interface PostgresConfig {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
    max?: number;
    idleTimeoutMillis?: number;
    connectionTimeoutMillis?: number;
    vectorDimension?: number;
    indexMethod?: 'ivfflat' | 'hnsw';
    lists?: number;
}

export interface MongoConfig {
    uri: string;
    database: string;
    options?: {
        useUnifiedTopology?: boolean;
        timeseries?: {
            collections: string[];
        };
    };
}

export interface QdrantConfig {
    url: string;
    apiKey?: string;
    collection?: string;
    vectorSize?: number;
    distance?: 'Cosine' | 'Euclidean' | 'Dot';
    onDiskPayload?: boolean;
}

export interface RoutingRule {
    type: EntityType;
    primary: 'redis' | 'postgres' | 'mongodb' | 'qdrant';
    cache?: 'redis';
    search?: 'qdrant' | 'postgres';
    metrics?: 'postgres';
}

export interface PersistenceConfig {
    redis?: RedisConfig;
    postgres?: PostgresConfig;
    mongodb?: MongoConfig;
    qdrant?: QdrantConfig;

    strategy?: 'single' | 'hybrid' | 'distributed';
    routingRules?: RoutingRule[];

    cache?: {
        enabled: boolean;
        ttl: number;
        maxSize: number;
        evictionPolicy: 'lru' | 'lfu' | 'fifo';
    };

    vectors?: {
        enabled: boolean;
        dimensions: number;
        model: string;
    };

    embedding?: EmbeddingConfig;
}

export interface WorkflowDefinition {
    id: string;
    name: string;
    description?: string;
    version?: number;
    nodes: any[];
    edges: any[];
    metadata?: Record<string, any>;
}

export interface WorkflowExecution {
    id: string;
    workflowId: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    currentNode?: string;
    startTime: Date;
    endTime?: Date;
    metrics?: Record<string, any>;
    state: Record<string, any>;
}

export interface AgentMemory {
    id: string;
    content: string;
    timestamp: Date;
    metadata?: Record<string, any>;
    context?: any;
    embedding?: number[];
}

export interface SearchQuery {
    vector?: number[];
    text?: string;
    collection: string;
    filters?: Record<string, any>;
    aggregation?: any[];
    limit?: number;
}

export class PersistenceManager extends EventEmitter {
    private redis?: ICacheAdapter;
    private postgres?: IRelationalAdapter;
    private mongodb?: IDocumentAdapter;
    private qdrant?: IVectorAdapter;
    private strategy?: IPersistenceStrategy;
    private logger: Logger;
    private config: PersistenceConfig;
    private initialized: boolean = false;
    private embeddingService?: EmbeddingService;

    constructor(config: PersistenceConfig) {
        super();
        this.logger = Logger.getLogger('PersistenceManager');
        this.config = config;
    }

    async initialize(): Promise<void> {
        if (this.initialized) {
            this.logger.warn('PersistenceManager already initialized');
            return;
        }

        this.logger.info('Initializing PersistenceManager...');
        await this.initializeAdapters(this.config);
        this.strategy = await this.createStrategy(this.config);

        // Initialize embedding service if configured
        if (this.config.vectors?.enabled && this.config.embedding) {
            this.embeddingService = new EmbeddingService(this.config.embedding);
            this.logger.info('Embedding service initialized');
        }

        this.initialized = true;

        this.emit('initialized');
        this.logger.info('PersistenceManager initialized successfully');
    }

    private async initializeAdapters(config: PersistenceConfig): Promise<void> {
        const initPromises: Promise<void>[] = [];

        if (config.redis) {
            this.logger.debug('Initializing Redis adapter...');
            const { RedisAdapter } = await import('./adapters/redis/RedisAdapter');
            this.redis = new RedisAdapter(config.redis);
            initPromises.push((this.redis as any).connect());
        }

        if (config.postgres) {
            this.logger.debug('Initializing PostgreSQL adapter...');
            const { PostgresAdapter } = await import('./adapters/postgres/PostgresAdapter');
            this.postgres = new PostgresAdapter(config.postgres);
            initPromises.push((this.postgres as any).connect());
        }

        if (config.mongodb) {
            this.logger.debug('Initializing MongoDB adapter...');
            const { MongoAdapter } = await import('./adapters/mongodb/MongoAdapter');
            this.mongodb = new MongoAdapter(config.mongodb);
            initPromises.push((this.mongodb as any).connect());
        }

        if (config.qdrant) {
            this.logger.debug('Initializing Qdrant adapter...');
            const { QdrantAdapter } = await import('./adapters/qdrant/QdrantAdapter');
            this.qdrant = new QdrantAdapter(config.qdrant);
            initPromises.push((this.qdrant as any).connect());
        }

        await Promise.all(initPromises);
    }

    private async createStrategy(config: PersistenceConfig): Promise<IPersistenceStrategy> {
        const strategyType = config.strategy || 'hybrid';

        switch (strategyType) {
            case 'hybrid':
                const { HybridStrategy } = await import('./strategies/HybridStrategy');
                return new HybridStrategy(
                    this.redis!,
                    this.postgres!,
                    this.mongodb!,
                    this.qdrant!,
                    config.routingRules
                );

            case 'single':
                const { SingleBackendStrategy } = await import('./strategies/SingleBackendStrategy');
                return new SingleBackendStrategy(
                    this.redis || this.postgres || this.mongodb || this.qdrant!
                );

            case 'distributed':
                const { DistributedStrategy } = await import('./strategies/DistributedStrategy');
                return new DistributedStrategy(
                    this.redis!,
                    this.postgres!,
                    this.mongodb!,
                    this.qdrant!
                );

            default:
                throw new Error(`Unknown strategy type: ${strategyType}`);
        }
    }

    async saveWorkflow(workflow: WorkflowDefinition): Promise<void> {
        this.ensureInitialized();

        try {
            const savePromises: Promise<void>[] = [];

            if (this.postgres) {
                savePromises.push(
                    this.postgres.save('workflows', workflow.id, {
                        id: workflow.id,
                        name: workflow.name,
                        definition: JSON.stringify(workflow),
                        created_at: new Date(),
                        version: workflow.version || 1
                    })
                );
            }

            if (this.redis) {
                savePromises.push(
                    this.redis.setex(
                        `workflow:${workflow.id}`,
                        workflow,
                        this.config.cache?.ttl || 3600
                    )
                );
            }

            if (workflow.description && this.qdrant && this.config.vectors?.enabled) {
                const embedding = await this.generateEmbedding(workflow.description);
                savePromises.push(
                    this.qdrant.upsertSingle({
                        id: workflow.id,
                        vector: embedding,
                        payload: {
                            type: 'workflow',
                            name: workflow.name,
                            description: workflow.description
                        }
                    })
                );
            }

            await Promise.all(savePromises);

            this.emit('workflow:saved', { id: workflow.id });
            this.logger.debug(`Workflow ${workflow.id} saved successfully`);

        } catch (error) {
            this.logger.error('Failed to save workflow:', error);
            throw error;
        }
    }

    async saveExecution(execution: WorkflowExecution): Promise<void> {
        this.ensureInitialized();

        try {
            const savePromises: Promise<void>[] = [];

            if (this.mongodb) {
                savePromises.push(
                    this.mongodb.save('executions', execution.id, execution)
                );
            }

            if (this.redis) {
                savePromises.push(
                    this.redis.hmset(
                        `execution:${execution.id}`,
                        {
                            status: execution.status,
                            current_node: execution.currentNode || '',
                            updated_at: new Date().toISOString()
                        }
                    )
                );
            }

            if (this.postgres) {
                savePromises.push(
                    this.postgres.save('execution_history', execution.id, {
                        id: execution.id,
                        workflow_id: execution.workflowId,
                        status: execution.status,
                        started_at: execution.startTime,
                        ended_at: execution.endTime,
                        metrics: JSON.stringify(execution.metrics || {})
                    })
                );
            }

            await Promise.all(savePromises);

            this.emit('execution:saved', { id: execution.id, status: execution.status });
            this.logger.debug(`Execution ${execution.id} saved successfully`);

        } catch (error) {
            this.logger.error('Failed to save execution:', error);
            throw error;
        }
    }

    async saveAgentMemory(agentId: string, memory: AgentMemory): Promise<void> {
        this.ensureInitialized();

        try {
            const savePromises: Promise<void>[] = [];

            if (this.mongodb) {
                savePromises.push(
                    this.mongodb.save(
                        'agent_memories',
                        `${agentId}:${memory.id}`,
                        memory
                    )
                );
            }

            if (this.config.vectors?.enabled) {
                const embedding = memory.embedding || await this.generateEmbedding(memory.content);

                if (this.postgres) {
                    savePromises.push(
                        this.postgres.query(`
                            INSERT INTO agent_memories (agent_id, content, embedding, timestamp)
                            VALUES ($1, $2, $3, $4)
                            ON CONFLICT (agent_id, timestamp) DO UPDATE
                            SET content = $2, embedding = $3
                        `, [agentId, memory.content, embedding, memory.timestamp]).then(() => {})
                    );
                }

                if (this.qdrant) {
                    savePromises.push(
                        this.qdrant.upsertSingle({
                            id: `${agentId}:${memory.id}`,
                            vector: embedding,
                            payload: {
                                agent_id: agentId,
                                timestamp: memory.timestamp,
                                type: 'memory',
                                content_preview: memory.content.substring(0, 200)
                            }
                        })
                    );
                }
            }

            await Promise.all(savePromises);

            this.emit('memory:saved', { agentId, memoryId: memory.id });
            this.logger.debug(`Agent memory ${memory.id} saved for agent ${agentId}`);

        } catch (error) {
            this.logger.error('Failed to save agent memory:', error);
            throw error;
        }
    }

    async searchSimilar(query: string, options?: SearchOptions): Promise<SearchResult[]> {
        this.ensureInitialized();

        if (!this.config.vectors?.enabled) {
            throw new Error('Vector search is not enabled');
        }

        try {
            const embedding = await this.generateEmbedding(query);
            const searchPromises: Promise<any>[] = [];

            if (this.postgres) {
                searchPromises.push(
                    this.postgres.vectorSearch(
                        embedding,
                        options?.limit || 10,
                        options?.threshold || 0.5
                    )
                );
            }

            if (this.qdrant) {
                searchPromises.push(
                    this.qdrant.search({
                        vector: embedding,
                        limit: options?.limit || 10,
                        filter: options?.filter,
                        score_threshold: options?.threshold
                    })
                );
            }

            const results = await Promise.all(searchPromises);
            return this.mergeSearchResults(...results);

        } catch (error) {
            this.logger.error('Failed to perform similarity search:', error);
            throw error;
        }
    }

    async getCached<T>(key: string): Promise<T | null> {
        if (!this.redis) {
            return null;
        }

        try {
            const cached = await this.redis.get<T>(key);
            if (cached) {
                this.emit('cache:hit', { key });
                return cached;
            }
            this.emit('cache:miss', { key });
            return null;
        } catch (error) {
            this.logger.error('Cache get failed:', error);
            return null;
        }
    }

    async setCached<T>(key: string, value: T, ttl?: number): Promise<void> {
        if (!this.redis) {
            return;
        }

        try {
            await this.redis.setex(
                key,
                value,
                ttl || this.config.cache?.ttl || 3600
            );
        } catch (error) {
            this.logger.error('Cache set failed:', error);
        }
    }

    async invalidateCache(pattern: string): Promise<void> {
        if (!this.redis) {
            return;
        }

        try {
            const keys = await this.redis.keys(pattern);
            if (keys && keys.length > 0) {
                await this.redis.del(...keys);
                this.emit('cache:invalidated', { pattern, count: keys.length });
            }
        } catch (error) {
            this.logger.error('Cache invalidation failed:', error);
        }
    }

    async queryWorkflows(criteria: QueryCriteria): Promise<WorkflowDefinition[]> {
        this.ensureInitialized();

        try {
            if (criteria.filters && Object.keys(criteria.filters).length > 0 && this.postgres) {
                const results = await this.postgres.find('workflows', criteria.filters);
                return results.map((r: any) => JSON.parse(r.definition));
            }

            if ((criteria.nested || criteria.aggregation) && this.mongodb) {
                return await this.mongodb.aggregate('workflows', criteria.aggregation || []);
            }

            if (criteria.semantic) {
                const results = await this.searchSimilar(criteria.semantic, {
                    filter: { type: 'workflow' }
                });
                return results.map(r => r.payload as WorkflowDefinition);
            }

            if (this.redis) {
                const keys = await this.redis.keys('workflow:*');
                const workflows: WorkflowDefinition[] = [];
                for (const key of keys) {
                    const workflow = await this.redis.get<WorkflowDefinition>(key);
                    if (workflow) {
                        workflows.push(workflow);
                    }
                }
                return workflows;
            }

            return [];
        } catch (error) {
            this.logger.error('Failed to query workflows:', error);
            throw error;
        }
    }

    async transaction<T>(fn: () => Promise<T>): Promise<T> {
        if (!this.postgres) {
            throw new Error('PostgreSQL adapter is required for transactions');
        }

        return this.postgres.transaction(fn);
    }

    async runMigrations(): Promise<void> {
        this.ensureInitialized();

        const migrationPromises: Promise<void>[] = [];

        if (this.postgres) {
            this.logger.info('Running PostgreSQL migrations...');
            const { migrations } = await import('./adapters/postgres/migrations');
            migrationPromises.push(this.postgres.migrate(migrations));
        }

        if (this.mongodb) {
            this.logger.info('Ensuring MongoDB indexes...');
            migrationPromises.push(this.ensureMongoIndexes());
        }

        if (this.qdrant) {
            this.logger.info('Ensuring Qdrant collections...');
            migrationPromises.push(this.ensureQdrantCollections());
        }

        await Promise.all(migrationPromises);
        this.logger.info('All migrations completed successfully');
    }

    private async ensureMongoIndexes(): Promise<void> {
        if (!this.mongodb) return;

        await this.mongodb.createIndex('workflows', { id: 1 }, { unique: true });
        await this.mongodb.createIndex('workflows', { name: 1 });
        await this.mongodb.createIndex('workflows', { 'metadata.created_at': -1 });

        await this.mongodb.createIndex('executions', { id: 1 }, { unique: true });
        await this.mongodb.createIndex('executions', { workflowId: 1 });
        await this.mongodb.createIndex('executions', { status: 1 });
        await this.mongodb.createIndex('executions', { startTime: -1 });

        await this.mongodb.createIndex('agent_memories', { agent_id: 1, timestamp: -1 });
    }

    private async ensureQdrantCollections(): Promise<void> {
        if (!this.qdrant) return;

        const collectionName = this.config.qdrant?.collection || 'tri-protocol';
        const collections = await this.qdrant.listCollections();

        if (!collections.find(c => c.name === collectionName)) {
            await this.qdrant.createCollection(collectionName, {
                vectors: {
                    size: this.config.vectors?.dimensions || 1536,
                    distance: this.config.qdrant?.distance || 'Cosine'
                }
            });
        }
    }

    private async generateEmbedding(text: string): Promise<number[]> {
        if (this.embeddingService) {
            const result = await this.embeddingService.generateEmbedding(text);
            return result.embedding;
        }

        // Fallback to mock embedding if service not configured
        this.logger.warn('Embedding service not configured, using mock embeddings');
        return Array(this.config.vectors?.dimensions || 1536).fill(0).map(() => Math.random());
    }

    private mergeSearchResults(...results: any[]): SearchResult[] {
        const merged = new Map<string, SearchResult>();

        for (const resultSet of results) {
            if (!resultSet) continue;

            for (const result of resultSet) {
                const existing = merged.get(result.id);
                if (!existing || result.score > existing.score) {
                    merged.set(result.id, result);
                }
            }
        }

        return Array.from(merged.values())
            .sort((a, b) => b.score - a.score);
    }

    private ensureInitialized(): void {
        if (!this.initialized) {
            throw new Error('PersistenceManager not initialized. Call initialize() first.');
        }
    }

    async shutdown(): Promise<void> {
        this.logger.info('Shutting down PersistenceManager...');

        const shutdownPromises: Promise<void>[] = [];

        if (this.redis) {
            shutdownPromises.push((this.redis as any).disconnect());
        }

        if (this.postgres) {
            shutdownPromises.push((this.postgres as any).disconnect());
        }

        if (this.mongodb) {
            shutdownPromises.push((this.mongodb as any).disconnect());
        }

        if (this.qdrant) {
            shutdownPromises.push((this.qdrant as any).disconnect());
        }

        await Promise.all(shutdownPromises);

        this.initialized = false;
        this.emit('shutdown');
        this.logger.info('PersistenceManager shut down successfully');
    }
}