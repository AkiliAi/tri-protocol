import { EntityType, IPersistenceStrategy, SearchResult } from '../interfaces/IPersistenceAdapter';
import { ICacheAdapter } from '../interfaces/ICacheAdapter';
import { IDocumentAdapter } from '../interfaces/IDocumentAdapter';
import { IVectorAdapter } from '../interfaces/IVectorAdapter';
import { IRelationalAdapter } from '../interfaces/IRelationalAdapter';
import { RoutingRule } from '../PersistenceManager';
// @ts-ignore
import { Logger } from '@tri-protocol/logger';

export interface HybridSearchQuery {
    vector?: number[];
    text?: string;
    collection: string;
    filters?: Record<string, any>;
    aggregation?: any[];
    limit?: number;
}

export class HybridStrategy implements IPersistenceStrategy {
    private logger: Logger;
    private routingRules: Map<EntityType, RoutingRule>;

    constructor(
        private redis: ICacheAdapter,
        private postgres: IRelationalAdapter,
        private mongodb: IDocumentAdapter,
        private qdrant: IVectorAdapter,
        routingRules?: RoutingRule[]
    ) {
        this.logger = Logger.getLogger('HybridStrategy');
        this.routingRules = new Map();

        if (routingRules) {
            routingRules.forEach(rule => {
                this.routingRules.set(rule.type, rule);
            });
        } else {
            this.setupDefaultRouting();
        }
    }

    private setupDefaultRouting(): void {
        this.routingRules.set('workflow', {
            type: 'workflow',
            primary: 'postgres',
            cache: 'redis',
            search: 'qdrant'
        });

        this.routingRules.set('execution', {
            type: 'execution',
            primary: 'mongodb',
            cache: 'redis',
            metrics: 'postgres'
        });

        this.routingRules.set('agent_memory', {
            type: 'agent_memory',
            primary: 'mongodb',
            cache: 'redis',
            search: 'qdrant',
            metrics: 'postgres'
        });

        this.routingRules.set('message', {
            type: 'message',
            primary: 'mongodb',
            cache: 'redis',
            search: 'qdrant'
        });

        this.routingRules.set('task', {
            type: 'task',
            primary: 'postgres',
            cache: 'redis'
        });
    }

    async save(type: EntityType, data: any): Promise<void> {
        const rule = this.routingRules.get(type);
        if (!rule) {
            throw new Error(`No routing rule for entity type: ${type}`);
        }

        const savePromises: Promise<void>[] = [];

        try {
            switch (type) {
                case 'workflow':
                    await this.saveWorkflow(data);
                    break;

                case 'execution':
                    await this.saveExecution(data);
                    break;

                case 'agent_memory':
                    await this.saveAgentMemory(data);
                    break;

                case 'message':
                    await this.saveMessage(data);
                    break;

                case 'task':
                    await this.saveTask(data);
                    break;

                case 'agent':
                    await this.saveAgent(data);
                    break;

                default:
                    await this.saveGeneric(type, data, rule);
            }

            this.logger.debug(`Saved ${type} with id: ${data.id}`);
        } catch (error) {
            this.logger.error(`Failed to save ${type}:`, error);
            throw error;
        }
    }

    private async saveWorkflow(data: any): Promise<void> {
        const promises: Promise<void>[] = [];

        promises.push(
            this.postgres.save('workflows', data.id, {
                id: data.id,
                name: data.name,
                definition: JSON.stringify(data),
                created_at: new Date(),
                version: data.version || 1
            })
        );

        promises.push(
            this.redis.setex(`workflow:${data.id}`, data, 3600)
        );

        if (data.description) {
            const embedding = await this.generateEmbedding(data.description);
            promises.push(
                this.qdrant.upsertSingle({
                    id: data.id,
                    vector: embedding,
                    payload: {
                        type: 'workflow',
                        name: data.name,
                        description: data.description
                    }
                })
            );
        }

        await Promise.all(promises);
    }

    private async saveExecution(data: any): Promise<void> {
        const promises: Promise<void>[] = [];

        promises.push(
            this.mongodb.save('executions', data.id, data)
        );

        promises.push(
            this.redis.hmset(`execution:${data.id}`, {
                status: data.status,
                current_node: data.currentNode || '',
                updated_at: new Date().toISOString()
            })
        );

        promises.push(
            this.postgres.save('execution_history', data.id, {
                id: data.id,
                workflow_id: data.workflowId,
                status: data.status,
                started_at: data.startTime,
                ended_at: data.endTime,
                metrics: JSON.stringify(data.metrics || {})
            })
        );

        await Promise.all(promises);
    }

    private async saveAgentMemory(data: any): Promise<void> {
        const promises: Promise<void>[] = [];

        promises.push(
            this.mongodb.save('agent_memories', `${data.agentId}:${data.id}`, data)
        );

        const embedding = data.embedding || await this.generateEmbedding(data.content);

        promises.push(
            this.postgres.query(`
                INSERT INTO agent_memories (agent_id, content, embedding, timestamp)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (agent_id, timestamp) DO UPDATE
                SET content = $2, embedding = $3
            `, [data.agentId, data.content, embedding, data.timestamp]).then(() => {})
        );

        promises.push(
            this.qdrant.upsertSingle({
                id: `${data.agentId}:${data.id}`,
                vector: embedding,
                payload: {
                    agent_id: data.agentId,
                    timestamp: data.timestamp,
                    type: 'memory',
                    content_preview: data.content.substring(0, 200)
                }
            })
        );

        await Promise.all(promises);
    }

    private async saveMessage(data: any): Promise<void> {
        const promises: Promise<void>[] = [];

        promises.push(
            this.mongodb.save('messages', data.id, data)
        );

        promises.push(
            this.redis.setex(`message:${data.id}`, data, 300)
        );

        if (data.content) {
            const embedding = await this.generateEmbedding(data.content);
            promises.push(
                this.qdrant.upsertSingle({
                    id: data.id,
                    vector: embedding,
                    payload: {
                        type: 'message',
                        from: data.from,
                        to: data.to,
                        timestamp: data.timestamp
                    }
                })
            );
        }

        await Promise.all(promises);
    }

    private async saveTask(data: any): Promise<void> {
        const promises: Promise<void>[] = [];

        promises.push(
            this.postgres.save('tasks', data.id, data)
        );

        promises.push(
            this.redis.setex(`task:${data.id}`, data, 1800)
        );

        await Promise.all(promises);
    }

    private async saveAgent(data: any): Promise<void> {
        const promises: Promise<void>[] = [];

        promises.push(
            this.postgres.save('agents', data.id, data)
        );

        promises.push(
            this.redis.setex(`agent:${data.id}`, data, 7200)
        );

        await Promise.all(promises);
    }

    private async saveGeneric(type: EntityType, data: any, rule: RoutingRule): Promise<void> {
        const promises: Promise<void>[] = [];

        if (rule.primary === 'postgres') {
            promises.push(this.postgres.save(type, data.id, data));
        } else if (rule.primary === 'mongodb') {
            promises.push(this.mongodb.save(type, data.id, data));
        }

        if (rule.cache === 'redis') {
            promises.push(this.redis.setex(`${type}:${data.id}`, data, 3600));
        }

        await Promise.all(promises);
    }

    async load(type: EntityType, id: string): Promise<any> {
        try {
            const cached = await this.redis.get(`${type}:${id}`);
            if (cached) {
                this.logger.debug(`Cache hit for ${type}:${id}`);
                return cached;
            }

            const rule = this.routingRules.get(type);
            if (!rule) {
                throw new Error(`No routing rule for entity type: ${type}`);
            }

            let data: any = null;

            if (rule.primary === 'postgres') {
                data = await this.postgres.findOne(type, { id });
                if (data && data.definition) {
                    data = JSON.parse(data.definition);
                }
            } else if (rule.primary === 'mongodb') {
                data = await this.mongodb.findOne(type, { _id: id });
            }

            if (data && rule.cache === 'redis') {
                await this.redis.setex(`${type}:${id}`, data, 3600);
            }

            return data;
        } catch (error) {
            this.logger.error(`Failed to load ${type}:${id}:`, error);
            throw error;
        }
    }

    async delete(type: EntityType, id: string): Promise<void> {
        const rule = this.routingRules.get(type);
        if (!rule) {
            throw new Error(`No routing rule for entity type: ${type}`);
        }

        const deletePromises: Promise<void>[] = [];

        try {
            if (rule.primary === 'postgres') {
                deletePromises.push(this.postgres.delete(type, id));
            } else if (rule.primary === 'mongodb') {
                deletePromises.push(this.mongodb.delete(type, id));
            }

            if (rule.cache === 'redis') {
                deletePromises.push(
                    this.redis.del(`${type}:${id}`).then(() => {})
                );
            }

            if (rule.search === 'qdrant') {
                deletePromises.push(this.qdrant.delete([id]));
            }

            await Promise.all(deletePromises);

            this.logger.debug(`Deleted ${type}:${id}`);
        } catch (error) {
            this.logger.error(`Failed to delete ${type}:${id}:`, error);
            throw error;
        }
    }

    async search(query: HybridSearchQuery): Promise<SearchResult[]> {
        try {
            if (query.vector) {
                const searchPromises: Promise<any[]>[] = [];

                searchPromises.push(
                    this.qdrant.search({
                        vector: query.vector,
                        filter: query.filters,
                        limit: query.limit || 10
                    })
                );

                searchPromises.push(
                    this.postgres.vectorSearch(
                        query.vector,
                        query.limit || 10
                    )
                );

                const results = await Promise.all(searchPromises);
                return this.mergeSearchResults(...results);
            }

            if (query.filters) {
                const results = await this.postgres.find(query.collection, query.filters);
                return results.map(r => ({
                    id: r.id,
                    score: 1,
                    payload: r
                }));
            }

            if (query.aggregation) {
                const results = await this.mongodb.aggregate(query.collection, query.aggregation);
                return results.map(r => ({
                    id: r._id || r.id,
                    score: 1,
                    payload: r
                }));
            }

            if (query.text) {
                const results = await this.postgres.textSearch(query.text, query.collection, ['content', 'name', 'description']);
                return results.map(r => ({
                    id: r.id,
                    score: r.rank || 1,
                    payload: r
                }));
            }

            return [];
        } catch (error) {
            this.logger.error('Search failed:', error);
            throw error;
        }
    }

    private mergeSearchResults(...results: any[]): SearchResult[] {
        const merged = new Map<string, SearchResult>();

        for (const resultSet of results) {
            if (!resultSet || !Array.isArray(resultSet)) continue;

            for (const result of resultSet) {
                const id = result.id || result._id;
                if (!id) continue;

                const existing = merged.get(id);
                const score = result.score || result.rank || (1 - (result.distance || 0));

                if (!existing || score > existing.score) {
                    merged.set(id, {
                        id,
                        score,
                        payload: result.payload || result
                    });
                }
            }
        }

        return Array.from(merged.values())
            .sort((a, b) => b.score - a.score);
    }

    private async generateEmbedding(text: string): Promise<number[]> {
        this.logger.warn('Using mock embedding generation - implement actual embedding service');
        return Array(1536).fill(0).map(() => Math.random());
    }
}