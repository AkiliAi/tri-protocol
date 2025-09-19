import { MongoClient, Db, Collection, ChangeStream } from 'mongodb';
import { IDocumentAdapter } from '../../interfaces/IDocumentAdapter';
import { MongoConfig } from './MongoConfig';
import { Logger } from '@tri-protocol/logger';

export class MongoAdapter implements IDocumentAdapter {
    private client: MongoClient;
    private db!: Db;
    private logger: Logger;
    private config: MongoConfig;
    private connected: boolean = false;
    private changeStreams: Map<string, ChangeStream> = new Map();

    constructor(config: MongoConfig) {
        this.config = config;
        this.logger = Logger.getLogger('MongoAdapter');
        this.client = new MongoClient(config.uri, config.options as any);
    }

    async connect(): Promise<void> {
        try {
            await this.client.connect();
            this.db = this.client.db(this.config.database);
            this.connected = true;
            await this.ensureIndexes();
            this.logger.info(`MongoDB connected to database: ${this.config.database}`);
        } catch (error) {
            this.logger.error('Failed to connect to MongoDB:', error);
            throw error;
        }
    }

    async disconnect(): Promise<void> {
        if (!this.connected) return;

        try {
            for (const [name, stream] of this.changeStreams) {
                await stream.close();
            }
            this.changeStreams.clear();

            await this.client.close();
            this.connected = false;
            this.logger.info('MongoDB disconnected');
        } catch (error) {
            this.logger.error('Failed to disconnect from MongoDB:', error);
            throw error;
        }
    }

    isConnected(): boolean {
        return this.connected;
    }

    async ensureIndexes(): Promise<void> {
        try {
            if (this.config.options?.timeseries?.collections) {
                for (const collectionName of this.config.options.timeseries.collections) {
                    const exists = await this.collectionExists(collectionName);
                    if (!exists) {
                        await this.db.createCollection(collectionName, {
                            timeseries: {
                                timeField: this.config.options.timeseries.timeField || 'timestamp',
                                metaField: this.config.options.timeseries.metaField || 'metadata',
                                granularity: this.config.options.timeseries.granularity || 'seconds'
                            }
                        });
                        this.logger.info(`Created time-series collection: ${collectionName}`);
                    }
                }
            }

            const collections = ['workflows', 'executions', 'agent_memories', 'messages', 'tasks'];
            for (const collectionName of collections) {
                const exists = await this.collectionExists(collectionName);
                if (!exists) {
                    await this.db.createCollection(collectionName);
                }
            }

        } catch (error) {
            this.logger.error('Failed to ensure indexes:', error);
            throw error;
        }
    }

    async save(collection: string, id: string, document: any): Promise<void> {
        try {
            await this.db.collection(collection).replaceOne(
                { _id: id as any },
                { _id: id as any, ...document, _updated: new Date() },
                { upsert: true }
            );
        } catch (error) {
            this.logger.error(`Failed to save document in ${collection}:`, error);
            throw error;
        }
    }

    async saveMany(collection: string, documents: any[]): Promise<void> {
        try {
            if (documents.length === 0) return;

            const bulkOps = documents.map(doc => ({
                replaceOne: {
                    filter: { _id: doc.id || doc._id },
                    replacement: { ...doc, _updated: new Date() },
                    upsert: true
                }
            }));

            await this.db.collection(collection).bulkWrite(bulkOps);
        } catch (error) {
            this.logger.error(`Failed to save multiple documents in ${collection}:`, error);
            throw error;
        }
    }

    async findOne(collection: string, query: any): Promise<any> {
        try {
            const result = await this.db.collection(collection).findOne(query);
            return result;
        } catch (error) {
            this.logger.error(`Failed to find document in ${collection}:`, error);
            throw error;
        }
    }

    async find(collection: string, query: any, options?: any): Promise<any[]> {
        try {
            let cursor = this.db.collection(collection).find(query);

            if (options?.sort) {
                cursor = cursor.sort(options.sort);
            }

            if (options?.limit) {
                cursor = cursor.limit(options.limit);
            }

            if (options?.skip) {
                cursor = cursor.skip(options.skip);
            }

            if (options?.projection) {
                cursor = cursor.project(options.projection);
            }

            return await cursor.toArray();
        } catch (error) {
            this.logger.error(`Failed to find documents in ${collection}:`, error);
            throw error;
        }
    }

    async update(collection: string, id: string, updates: any): Promise<void> {
        try {
            await this.db.collection(collection).updateOne(
                { _id: id as any },
                {
                    $set: { ...updates, _updated: new Date() }
                }
            );
        } catch (error) {
            this.logger.error(`Failed to update document in ${collection}:`, error);
            throw error;
        }
    }

    async updateMany(collection: string, query: any, updates: any): Promise<number> {
        try {
            const result = await this.db.collection(collection).updateMany(
                query,
                {
                    $set: { ...updates, _updated: new Date() }
                }
            );
            return result.modifiedCount;
        } catch (error) {
            this.logger.error(`Failed to update multiple documents in ${collection}:`, error);
            throw error;
        }
    }

    async delete(collection: string, id: string): Promise<void> {
        try {
            await this.db.collection(collection).deleteOne({ _id: id as any });
        } catch (error) {
            this.logger.error(`Failed to delete document from ${collection}:`, error);
            throw error;
        }
    }

    async deleteMany(collection: string, query: any): Promise<number> {
        try {
            const result = await this.db.collection(collection).deleteMany(query);
            return result.deletedCount;
        } catch (error) {
            this.logger.error(`Failed to delete multiple documents from ${collection}:`, error);
            throw error;
        }
    }

    async aggregate(collection: string, pipeline: any[]): Promise<any[]> {
        try {
            return await this.db.collection(collection).aggregate(pipeline).toArray();
        } catch (error) {
            this.logger.error(`Failed to aggregate in ${collection}:`, error);
            throw error;
        }
    }

    async createCollection(name: string, options?: any): Promise<void> {
        try {
            await this.db.createCollection(name, options);
            this.logger.info(`Created collection: ${name}`);
        } catch (error) {
            this.logger.error(`Failed to create collection ${name}:`, error);
            throw error;
        }
    }

    async dropCollection(name: string): Promise<void> {
        try {
            await this.db.collection(name).drop();
            this.logger.info(`Dropped collection: ${name}`);
        } catch (error) {
            this.logger.error(`Failed to drop collection ${name}:`, error);
            throw error;
        }
    }

    async collectionExists(name: string): Promise<boolean> {
        try {
            const collections = await this.db.listCollections({ name }).toArray();
            return collections.length > 0;
        } catch (error) {
            this.logger.error(`Failed to check collection existence ${name}:`, error);
            return false;
        }
    }

    async createIndex(collection: string, index: any, options?: any): Promise<void> {
        try {
            await this.db.collection(collection).createIndex(index, options);
        } catch (error) {
            this.logger.error(`Failed to create index on ${collection}:`, error);
            throw error;
        }
    }

    async dropIndex(collection: string, indexName: string): Promise<void> {
        try {
            await this.db.collection(collection).dropIndex(indexName);
        } catch (error) {
            this.logger.error(`Failed to drop index ${indexName} on ${collection}:`, error);
            throw error;
        }
    }

    async listIndexes(collection: string): Promise<any[]> {
        try {
            return await this.db.collection(collection).indexes();
        } catch (error) {
            this.logger.error(`Failed to list indexes on ${collection}:`, error);
            throw error;
        }
    }

    async saveTimeSeries(collection: string, data: any): Promise<void> {
        try {
            await this.db.collection(collection).insertOne({
                ...data,
                timestamp: data.timestamp || new Date()
            });
        } catch (error) {
            this.logger.error(`Failed to save time-series data to ${collection}:`, error);
            throw error;
        }
    }

    async queryTimeSeries(collection: string, startTime: Date, endTime: Date, query?: any): Promise<any[]> {
        try {
            const filter = {
                ...query,
                timestamp: {
                    $gte: startTime,
                    $lte: endTime
                }
            };

            return await this.db.collection(collection)
                .find(filter)
                .sort({ timestamp: 1 })
                .toArray();
        } catch (error) {
            this.logger.error(`Failed to query time-series data from ${collection}:`, error);
            throw error;
        }
    }

    watch(collection: string, callback: (change: any) => void): void {
        try {
            const changeStream = this.db.collection(collection).watch([], {
                fullDocument: 'updateLookup'
            });

            changeStream.on('change', callback);
            changeStream.on('error', (error) => {
                this.logger.error(`Change stream error on ${collection}:`, error);
            });

            this.changeStreams.set(collection, changeStream);
            this.logger.info(`Started watching collection: ${collection}`);
        } catch (error) {
            this.logger.error(`Failed to watch collection ${collection}:`, error);
            throw error;
        }
    }

    unwatch(collection: string): void {
        try {
            const stream = this.changeStreams.get(collection);
            if (stream) {
                stream.close();
                this.changeStreams.delete(collection);
                this.logger.info(`Stopped watching collection: ${collection}`);
            }
        } catch (error) {
            this.logger.error(`Failed to unwatch collection ${collection}:`, error);
        }
    }

    startSession(): any {
        return this.client.startSession();
    }

    async withTransaction<T>(fn: () => Promise<T>, options?: any): Promise<T> {
        const session = this.client.startSession();
        try {
            return await session.withTransaction(fn, options);
        } finally {
            await session.endSession();
        }
    }

    async count(collection: string, query?: any): Promise<number> {
        try {
            return await this.db.collection(collection).countDocuments(query || {});
        } catch (error) {
            this.logger.error(`Failed to count documents in ${collection}:`, error);
            throw error;
        }
    }

    async distinct(collection: string, field: string, query?: any): Promise<any[]> {
        try {
            return await this.db.collection(collection).distinct(field, query || {});
        } catch (error) {
            this.logger.error(`Failed to get distinct values from ${collection}.${field}:`, error);
            throw error;
        }
    }
}