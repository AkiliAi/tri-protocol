import { SearchResult } from './IPersistenceAdapter';

export interface VectorPoint {
    id: string;
    vector: number[];
    payload: Record<string, any>;
}

export interface SearchParams {
    vector: number[];
    limit?: number;
    filter?: any;
    with_payload?: boolean;
    with_vector?: boolean;
    score_threshold?: number;
}

export interface ClusterParams {
    k: number;
    limit?: number;
    distance?: 'cosine' | 'euclidean' | 'dot';
    iterations?: number;
}

export interface Cluster {
    id: string;
    centroid: number[];
    points: string[];
    size: number;
}

export interface CollectionInfo {
    name: string;
    vectors_count: number;
    points_count: number;
    config: any;
}

export interface IVectorAdapter {
    createCollection(name: string, config: any): Promise<void>;
    deleteCollection(name: string): Promise<void>;
    getCollection(name: string): Promise<CollectionInfo | null>;
    listCollections(): Promise<CollectionInfo[]>;

    upsert(points: VectorPoint[]): Promise<void>;
    upsertSingle(point: VectorPoint): Promise<void>;

    search(params: SearchParams): Promise<SearchResult[]>;
    searchBatch(searches: SearchParams[]): Promise<SearchResult[][]>;

    retrieve(ids: string[]): Promise<VectorPoint[]>;
    delete(ids: string[]): Promise<void>;

    count(filter?: any): Promise<number>;

    hybridSearch(text: string, vector: number[], filters?: any): Promise<any[]>;

    cluster(collection: string, params: ClusterParams): Promise<Cluster[]>;

    updatePayload(id: string, payload: Record<string, any>): Promise<void>;

    snapshot(path: string): Promise<void>;
    recover(path: string): Promise<void>;
}