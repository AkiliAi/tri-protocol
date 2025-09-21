export interface AggregationPipeline {
    stage: string;
    params: any;
}

export interface TimeSeriesOptions {
    timeField: string;
    metaField?: string;
    granularity?: 'seconds' | 'minutes' | 'hours';
}

export interface IDocumentAdapter {
    save(collection: string, id: string, document: any): Promise<void>;
    saveMany(collection: string, documents: any[]): Promise<void>;

    findOne(collection: string, query: any): Promise<any>;
    find(collection: string, query: any, options?: any): Promise<any[]>;

    update(collection: string, id: string, updates: any): Promise<void>;
    updateMany(collection: string, query: any, updates: any): Promise<number>;

    delete(collection: string, id: string): Promise<void>;
    deleteMany(collection: string, query: any): Promise<number>;

    aggregate(collection: string, pipeline: any[]): Promise<any[]>;

    createCollection(name: string, options?: any): Promise<void>;
    dropCollection(name: string): Promise<void>;
    collectionExists(name: string): Promise<boolean>;

    createIndex(collection: string, index: any, options?: any): Promise<void>;
    dropIndex(collection: string, indexName: string): Promise<void>;
    listIndexes(collection: string): Promise<any[]>;

    saveTimeSeries(collection: string, data: any): Promise<void>;
    queryTimeSeries(collection: string, startTime: Date, endTime: Date, query?: any): Promise<any[]>;

    watch(collection: string, callback: (change: any) => void): void;
    unwatch(collection: string): void;

    startSession(): any;
    withTransaction<T>(fn: () => Promise<T>, options?: any): Promise<T>;
}