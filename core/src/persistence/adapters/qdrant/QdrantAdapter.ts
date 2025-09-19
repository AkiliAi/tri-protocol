import { QdrantClient } from '@qdrant/js-client-rest';
import { IVectorAdapter, VectorPoint, SearchParams, ClusterParams, Cluster, CollectionInfo } from '../../interfaces/IVectorAdapter';
import { SearchResult } from '../../interfaces/IPersistenceAdapter';
import { QdrantConfig } from '../../PersistenceManager';
import { Logger } from '@tri-protocol/logger';

export class QdrantAdapter implements IVectorAdapter {
    private client: QdrantClient;
    private logger: Logger;
    private config: QdrantConfig;
    private collectionName: string;
    private connected: boolean = false;

    constructor(config: QdrantConfig) {
        this.config = config;
        this.logger = Logger.getLogger('QdrantAdapter');
        this.collectionName = config.collection || 'tri-protocol';

        this.client = new QdrantClient({
            url: config.url,
            apiKey: config.apiKey
        });
    }

    async connect(): Promise<void> {
        try {
            await this.initialize();
            this.connected = true;
            this.logger.info(`Qdrant connected to ${this.config.url}`);
        } catch (error) {
            this.logger.error('Failed to connect to Qdrant:', error);
            throw error;
        }
    }

    async disconnect(): Promise<void> {
        this.connected = false;
        this.logger.info('Qdrant disconnected');
    }

    isConnected(): boolean {
        return this.connected;
    }

    private async initialize(): Promise<void> {
        try {
            const collections = await this.client.getCollections();

            if (!collections.collections.find(c => c.name === this.collectionName)) {
                await this.createCollection(this.collectionName, {
                    vectors: {
                        size: this.config.vectorSize || 1536,
                        distance: this.config.distance || 'Cosine'
                    },
                    optimizers_config: {
                        default_segment_number: 2
                    },
                    replication_factor: 2,
                    on_disk_payload: this.config.onDiskPayload || false
                });

                this.logger.info(`Created Qdrant collection: ${this.collectionName}`);
            }
        } catch (error) {
            this.logger.error('Failed to initialize Qdrant:', error);
            throw error;
        }
    }

    async createCollection(name: string, config: any): Promise<void> {
        try {
            await this.client.createCollection(name, config);
            this.logger.info(`Created collection: ${name}`);
        } catch (error) {
            this.logger.error(`Failed to create collection ${name}:`, error);
            throw error;
        }
    }

    async deleteCollection(name: string): Promise<void> {
        try {
            await this.client.deleteCollection(name);
            this.logger.info(`Deleted collection: ${name}`);
        } catch (error) {
            this.logger.error(`Failed to delete collection ${name}:`, error);
            throw error;
        }
    }

    async getCollection(name: string): Promise<CollectionInfo | null> {
        try {
            const info = await this.client.getCollection(name);
            return {
                name,
                vectors_count: info.vectors_count || 0,
                points_count: info.points_count || 0,
                config: info.config
            };
        } catch (error) {
            this.logger.error(`Failed to get collection ${name}:`, error);
            return null;
        }
    }

    async listCollections(): Promise<CollectionInfo[]> {
        try {
            const result = await this.client.getCollections();
            return result.collections.map(c => ({
                name: c.name,
                vectors_count: 0,
                points_count: 0,
                config: {}
            }));
        } catch (error) {
            this.logger.error('Failed to list collections:', error);
            return [];
        }
    }

    async upsert(points: VectorPoint[]): Promise<void> {
        if (points.length === 0) return;

        try {
            await this.client.upsert(this.collectionName, {
                wait: true,
                points: points.map(p => ({
                    id: p.id,
                    vector: p.vector,
                    payload: p.payload
                }))
            });
        } catch (error) {
            this.logger.error('Failed to upsert points:', error);
            throw error;
        }
    }

    async upsertSingle(point: VectorPoint): Promise<void> {
        await this.upsert([point]);
    }

    async search(params: SearchParams): Promise<SearchResult[]> {
        try {
            const result = await this.client.search(this.collectionName, {
                vector: params.vector,
                limit: params.limit || 10,
                filter: params.filter,
                with_payload: params.with_payload !== false,
                with_vector: params.with_vector || false,
                score_threshold: params.score_threshold
            });

            return result.map(hit => ({
                id: hit.id as string,
                score: hit.score,
                payload: hit.payload || {},
                distance: 1 - hit.score
            }));
        } catch (error) {
            this.logger.error('Search failed:', error);
            throw error;
        }
    }

    async searchBatch(searches: SearchParams[]): Promise<SearchResult[][]> {
        try {
            const promises = searches.map(params => this.search(params));
            return await Promise.all(promises);
        } catch (error) {
            this.logger.error('Batch search failed:', error);
            throw error;
        }
    }

    async retrieve(ids: string[]): Promise<VectorPoint[]> {
        try {
            const result = await this.client.retrieve(this.collectionName, {
                ids,
                with_payload: true,
                with_vector: true
            });

            return result.map(point => ({
                id: point.id as string,
                vector: point.vector as number[],
                payload: point.payload || {}
            }));
        } catch (error) {
            this.logger.error('Retrieve failed:', error);
            throw error;
        }
    }

    async delete(ids: string[]): Promise<void> {
        if (ids.length === 0) return;

        try {
            await this.client.delete(this.collectionName, {
                wait: true,
                points: ids
            });
        } catch (error) {
            this.logger.error('Delete failed:', error);
            throw error;
        }
    }

    async count(filter?: any): Promise<number> {
        try {
            const result = await this.client.count(this.collectionName, {
                filter,
                exact: true
            });
            return result.count;
        } catch (error) {
            this.logger.error('Count failed:', error);
            return 0;
        }
    }

    async hybridSearch(text: string, vector: number[], filters?: any): Promise<any[]> {
        const textFilter = text ? {
            must: [{
                key: 'content',
                match: { text }
            }]
        } : undefined;

        const combinedFilter = filters ? {
            must: [
                ...(textFilter?.must || []),
                ...(filters.must || [])
            ]
        } : textFilter;

        return this.search({
            vector,
            filter: combinedFilter,
            limit: 20
        });
    }

    async cluster(collection: string, params: ClusterParams): Promise<Cluster[]> {
        this.logger.warn('Clustering not implemented in Qdrant adapter');
        return [];
    }

    async updatePayload(id: string, payload: Record<string, any>): Promise<void> {
        try {
            await this.client.setPayload(this.collectionName, {
                wait: true,
                points: [id],
                payload
            });
        } catch (error) {
            this.logger.error('Update payload failed:', error);
            throw error;
        }
    }

    async snapshot(path: string): Promise<void> {
        this.logger.warn('Snapshot not implemented in Qdrant adapter');
    }

    async recover(path: string): Promise<void> {
        this.logger.warn('Recover not implemented in Qdrant adapter');
    }
}