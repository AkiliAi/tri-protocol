import { EntityType, IPersistenceStrategy, SearchResult } from '../interfaces/IPersistenceAdapter';
import { Logger } from '@tri-protocol/logger';

export class SingleBackendStrategy implements IPersistenceStrategy {
    private logger: Logger;
    private backend: any;

    constructor(backend: any) {
        this.backend = backend;
        this.logger = Logger.getLogger('SingleBackendStrategy');
    }

    async save(type: EntityType, data: any): Promise<void> {
        await this.backend.save(type, data.id, data);
        this.logger.debug(`Saved ${type}:${data.id} to single backend`);
    }

    async load(type: EntityType, id: string): Promise<any> {
        const data = await this.backend.findOne(type, { id });
        this.logger.debug(`Loaded ${type}:${id} from single backend`);
        return data;
    }

    async delete(type: EntityType, id: string): Promise<void> {
        await this.backend.delete(type, id);
        this.logger.debug(`Deleted ${type}:${id} from single backend`);
    }

    async search(query: any): Promise<SearchResult[]> {
        if (this.backend.search) {
            return await this.backend.search(query);
        }

        if (this.backend.find) {
            const results = await this.backend.find(query.collection, query.filters || {});
            return results.map((r: any) => ({
                id: r.id || r._id,
                score: 1,
                payload: r
            }));
        }

        return [];
    }
}