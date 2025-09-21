export interface MongoConfig {
    uri: string;
    database: string;
    options?: {
        useUnifiedTopology?: boolean;
        maxPoolSize?: number;
        minPoolSize?: number;
        maxIdleTimeMS?: number;
        waitQueueTimeoutMS?: number;
        serverSelectionTimeoutMS?: number;
        heartbeatFrequencyMS?: number;
        retryWrites?: boolean;
        retryReads?: boolean;
        w?: string | number;
        journal?: boolean;
        readPreference?: 'primary' | 'primaryPreferred' | 'secondary' | 'secondaryPreferred' | 'nearest';
        readConcern?: {
            level: 'local' | 'available' | 'majority' | 'linearizable' | 'snapshot';
        };
        timeseries?: {
            collections: string[];
            timeField?: string;
            metaField?: string;
            granularity?: 'seconds' | 'minutes' | 'hours';
        };
    };
}