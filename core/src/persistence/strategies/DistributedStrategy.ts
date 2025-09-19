import { EntityType, IPersistenceStrategy, SearchResult } from '../interfaces/IPersistenceAdapter';
import { ICacheAdapter } from '../interfaces/ICacheAdapter';
import { IDocumentAdapter } from '../interfaces/IDocumentAdapter';
import { IVectorAdapter } from '../interfaces/IVectorAdapter';
import { IRelationalAdapter } from '../interfaces/IRelationalAdapter';
import { Logger } from '@tri-protocol/logger';

export class DistributedStrategy implements IPersistenceStrategy {
    private logger: Logger;

    constructor(
        private redis: ICacheAdapter,
        private postgres: IRelationalAdapter,
        private mongodb: IDocumentAdapter,
        private qdrant: IVectorAdapter
    ) {
        this.logger = Logger.getLogger('DistributedStrategy');
    }

    async save(type: EntityType, data: any): Promise<void> {
        const promises: Promise<void>[] = [];

        promises.push(this.postgres.save(type, data.id, data));
        promises.push(this.mongodb.save(type, data.id, data));

        if (data.content || data.description) {
            const text = data.content || data.description;
            const embedding = await this.generateEmbedding(text);
            promises.push(
                this.qdrant.upsertSingle({
                    id: data.id,
                    vector: embedding,
                    payload: { type, ...data }
                })
            );
        }

        promises.push(this.redis.setex(`${type}:${data.id}`, data, 3600));

        await Promise.all(promises);
        this.logger.debug(`Saved ${type}:${data.id} to all backends`);
    }

    async load(type: EntityType, id: string): Promise<any> {
        const cached = await this.redis.get(`${type}:${id}`);
        if (cached) return cached;

        const postgresData = await this.postgres.findOne(type, { id });
        if (postgresData) {
            await this.redis.setex(`${type}:${id}`, postgresData, 3600);
            return postgresData;
        }

        const mongoData = await this.mongodb.findOne(type, { _id: id });
        if (mongoData) {
            await this.redis.setex(`${type}:${id}`, mongoData, 3600);
            return mongoData;
        }

        return null;
    }

    async delete(type: EntityType, id: string): Promise<void> {
        await Promise.all([
            this.postgres.delete(type, id).catch(() => {}),
            this.mongodb.delete(type, id).catch(() => {}),
            this.qdrant.delete([id]).catch(() => {}),
            this.redis.del(`${type}:${id}`).catch(() => {})
        ]);

        this.logger.debug(`Deleted ${type}:${id} from all backends`);
    }

    async search(query: any): Promise<SearchResult[]> {
        const results = await Promise.all([
            this.searchPostgres(query),
            this.searchMongoDB(query),
            this.searchQdrant(query)
        ]);

        return this.mergeResults(...results);
    }

    private async searchPostgres(query: any): Promise<SearchResult[]> {
        if (query.vector) {
            const results = await this.postgres.vectorSearch(query.vector, query.limit);
            return results.map(r => ({
                id: r.id,
                score: 1 - r.distance,
                payload: r
            }));
        }
        return [];
    }

    private async searchMongoDB(query: any): Promise<SearchResult[]> {
        if (query.filters) {
            const results = await this.mongodb.find(query.collection, query.filters);
            return results.map(r => ({
                id: r._id || r.id,
                score: 1,
                payload: r
            }));
        }
        return [];
    }

    private async searchQdrant(query: any): Promise<SearchResult[]> {
        if (query.vector) {
            return await this.qdrant.search({
                vector: query.vector,
                limit: query.limit,
                filter: query.filters
            });
        }
        return [];
    }

    private mergeResults(...resultSets: SearchResult[][]): SearchResult[] {
        const merged = new Map<string, SearchResult>();

        for (const results of resultSets) {
            for (const result of results) {
                const existing = merged.get(result.id);
                if (!existing || result.score > existing.score) {
                    merged.set(result.id, result);
                }
            }
        }

        return Array.from(merged.values()).sort((a, b) => b.score - a.score);
    }

    private async generateEmbedding(text: string): Promise<number[]> {
        return Array(1536).fill(0).map(() => Math.random());
    }
}