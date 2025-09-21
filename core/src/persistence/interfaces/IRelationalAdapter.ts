import { SearchResult } from './IPersistenceAdapter';

export interface QueryResult {
    rows: any[];
    rowCount: number;
    fields?: any[];
}

export interface MigrationFile {
    version: string;
    name: string;
    up: string;
    down: string;
}

export interface IRelationalAdapter {
    query(sql: string, params?: any[]): Promise<QueryResult>;
    execute(sql: string, params?: any[]): Promise<void>;

    save(table: string, id: string, data: any): Promise<void>;
    findOne(table: string, conditions: Record<string, any>): Promise<any>;
    find(table: string, conditions: Record<string, any>, options?: any): Promise<any[]>;
    update(table: string, id: string, data: any): Promise<void>;
    delete(table: string, id: string): Promise<void>;

    createTable(name: string, schema: any): Promise<void>;
    dropTable(name: string): Promise<void>;
    tableExists(name: string): Promise<boolean>;

    createIndex(table: string, columns: string[], options?: any): Promise<void>;
    dropIndex(table: string, indexName: string): Promise<void>;

    transaction<T>(fn: (client: any) => Promise<T>): Promise<T>;
    beginTransaction(): Promise<any>;
    commit(transaction: any): Promise<void>;
    rollback(transaction: any): Promise<void>;

    vectorSearch(embedding: number[], limit?: number, threshold?: number): Promise<any[]>;
    hybridSearch(text: string, embedding: number[], options?: any): Promise<any[]>;
    textSearch(text: string, table: string, columns: string[]): Promise<any[]>;

    migrate(migrations: MigrationFile[]): Promise<void>;
    getMigrationHistory(): Promise<string[]>;
    rollbackMigration(version: string): Promise<void>;

    backup(path: string): Promise<void>;
    restore(path: string): Promise<void>;

    vacuum(): Promise<void>;
    analyze(table?: string): Promise<void>;
}