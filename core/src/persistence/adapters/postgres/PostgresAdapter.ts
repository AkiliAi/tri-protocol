import { Pool, PoolClient, QueryResult as PgQueryResult } from 'pg';
// import pgvector from 'pgvector/pg';
import { IRelationalAdapter, QueryResult, MigrationFile } from '../../interfaces/IRelationalAdapter';
import { PostgresConfig } from './PostgresConfig';
import { Logger } from '@tri-protocol/logger';

export class PostgresAdapter implements IRelationalAdapter {
    private pool: Pool;
    private logger: Logger;
    private config: PostgresConfig;
    private connected: boolean = false;

    constructor(config: PostgresConfig) {
        this.config = config;
        this.logger = Logger.getLogger('PostgresAdapter');

        this.pool = new Pool({
            host: config.host,
            port: config.port,
            user: config.user,
            password: config.password,
            database: config.database,
            max: config.max || 20,
            idleTimeoutMillis: config.idleTimeoutMillis || 30000,
            connectionTimeoutMillis: config.connectionTimeoutMillis || 10000,
            ssl: config.ssl
        });

        // pgvector will be registered on first connection
        // pgvector.registerType(this.pool);
    }

    async connect(): Promise<void> {
        try {
            const client = await this.pool.connect();
            client.release();
            this.connected = true;
            await this.initialize();
            this.logger.info('PostgreSQL connected and initialized');
        } catch (error) {
            this.logger.error('Failed to connect to PostgreSQL:', error);
            throw error;
        }
    }

    async disconnect(): Promise<void> {
        if (!this.connected) return;

        try {
            await this.pool.end();
            this.connected = false;
            this.logger.info('PostgreSQL disconnected');
        } catch (error) {
            this.logger.error('Failed to disconnect from PostgreSQL:', error);
            throw error;
        }
    }

    isConnected(): boolean {
        return this.connected;
    }

    private async initialize(): Promise<void> {
        try {
            await this.query('CREATE EXTENSION IF NOT EXISTS vector');

            await this.query(`
                CREATE TABLE IF NOT EXISTS agent_memories (
                    id SERIAL PRIMARY KEY,
                    agent_id VARCHAR(255) NOT NULL,
                    content TEXT NOT NULL,
                    embedding vector(${this.config.vectorDimension || 1536}),
                    timestamp TIMESTAMP DEFAULT NOW(),
                    metadata JSONB,
                    UNIQUE(agent_id, timestamp)
                )
            `);

            const indexMethod = this.config.indexMethod || 'ivfflat';
            if (indexMethod === 'ivfflat') {
                await this.query(`
                    CREATE INDEX IF NOT EXISTS idx_embedding_ivfflat
                    ON agent_memories
                    USING ivfflat (embedding vector_cosine_ops)
                    WITH (lists = ${this.config.lists || 100})
                `);
            } else if (indexMethod === 'hnsw') {
                await this.query(`
                    CREATE INDEX IF NOT EXISTS idx_embedding_hnsw
                    ON agent_memories
                    USING hnsw (embedding vector_cosine_ops)
                    WITH (m = ${this.config.m || 16}, ef_construction = ${this.config.efConstruction || 64})
                `);
            }

            await this.query(`
                CREATE TABLE IF NOT EXISTS workflows (
                    id VARCHAR(255) PRIMARY KEY,
                    name VARCHAR(255) NOT NULL,
                    definition JSONB NOT NULL,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW(),
                    version INTEGER DEFAULT 1,
                    metadata JSONB
                )
            `);

            await this.query(`
                CREATE TABLE IF NOT EXISTS execution_history (
                    id VARCHAR(255) PRIMARY KEY,
                    workflow_id VARCHAR(255) REFERENCES workflows(id),
                    status VARCHAR(50) NOT NULL,
                    started_at TIMESTAMP NOT NULL,
                    ended_at TIMESTAMP,
                    metrics JSONB,
                    created_at TIMESTAMP DEFAULT NOW()
                )
            `);

            await this.query(`
                CREATE TABLE IF NOT EXISTS migration_history (
                    version VARCHAR(255) PRIMARY KEY,
                    name VARCHAR(255) NOT NULL,
                    executed_at TIMESTAMP DEFAULT NOW()
                )
            `);

            await this.query(`
                CREATE INDEX IF NOT EXISTS idx_workflows_name ON workflows(name);
                CREATE INDEX IF NOT EXISTS idx_workflows_created_at ON workflows(created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_execution_workflow_id ON execution_history(workflow_id);
                CREATE INDEX IF NOT EXISTS idx_execution_status ON execution_history(status);
                CREATE INDEX IF NOT EXISTS idx_execution_started_at ON execution_history(started_at DESC);
            `);

        } catch (error) {
            this.logger.error('Failed to initialize PostgreSQL schema:', error);
            throw error;
        }
    }

    async query(sql: string, params?: any[]): Promise<QueryResult> {
        try {
            const result = await this.pool.query(sql, params);
            return {
                rows: result.rows,
                rowCount: result.rowCount || 0,
                fields: result.fields
            };
        } catch (error) {
            this.logger.error('Query failed:', { sql, params, error });
            throw error;
        }
    }

    async execute(sql: string, params?: any[]): Promise<void> {
        await this.query(sql, params);
    }

    async save(table: string, id: string, data: any): Promise<void> {
        const columns = Object.keys(data);
        const values = Object.values(data);
        const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');

        const updateColumns = columns
            .filter(col => col !== 'id')
            .map((col, i) => `${col} = EXCLUDED.${col}`)
            .join(', ');

        const sql = `
            INSERT INTO ${table} (${columns.join(', ')})
            VALUES (${placeholders})
            ON CONFLICT (id) DO UPDATE
            SET ${updateColumns}
        `;

        await this.execute(sql, values);
    }

    async findOne(table: string, conditions: Record<string, any>): Promise<any> {
        const whereClause = Object.keys(conditions)
            .map((key, i) => `${key} = $${i + 1}`)
            .join(' AND ');

        const sql = `SELECT * FROM ${table} WHERE ${whereClause} LIMIT 1`;
        const result = await this.query(sql, Object.values(conditions));
        return result.rows[0] || null;
    }

    async find(table: string, conditions: Record<string, any>, options?: any): Promise<any[]> {
        let sql = `SELECT * FROM ${table}`;

        if (Object.keys(conditions).length > 0) {
            const whereClause = Object.keys(conditions)
                .map((key, i) => `${key} = $${i + 1}`)
                .join(' AND ');
            sql += ` WHERE ${whereClause}`;
        }

        if (options?.orderBy) {
            const orderClauses = Object.entries(options.orderBy)
                .map(([col, dir]) => `${col} ${dir === 'desc' ? 'DESC' : 'ASC'}`)
                .join(', ');
            sql += ` ORDER BY ${orderClauses}`;
        }

        if (options?.limit) {
            sql += ` LIMIT ${options.limit}`;
        }

        if (options?.offset) {
            sql += ` OFFSET ${options.offset}`;
        }

        const result = await this.query(sql, Object.values(conditions));
        return result.rows;
    }

    async update(table: string, id: string, data: any): Promise<void> {
        const columns = Object.keys(data).filter(key => key !== 'id');
        const setClause = columns
            .map((col, i) => `${col} = $${i + 2}`)
            .join(', ');

        const sql = `UPDATE ${table} SET ${setClause} WHERE id = $1`;
        const values = [id, ...columns.map(col => data[col])];

        await this.execute(sql, values);
    }

    async delete(table: string, id: string): Promise<void> {
        const sql = `DELETE FROM ${table} WHERE id = $1`;
        await this.execute(sql, [id]);
    }

    async createTable(name: string, schema: any): Promise<void> {
        const columns = Object.entries(schema)
            .map(([col, type]) => `${col} ${type}`)
            .join(', ');

        const sql = `CREATE TABLE IF NOT EXISTS ${name} (${columns})`;
        await this.execute(sql);
    }

    async dropTable(name: string): Promise<void> {
        const sql = `DROP TABLE IF EXISTS ${name} CASCADE`;
        await this.execute(sql);
    }

    async tableExists(name: string): Promise<boolean> {
        const sql = `
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_schema = 'public'
                AND table_name = $1
            )
        `;
        const result = await this.query(sql, [name]);
        return result.rows[0]?.exists || false;
    }

    async createIndex(table: string, columns: string[], options?: any): Promise<void> {
        const indexName = options?.name || `idx_${table}_${columns.join('_')}`;
        const unique = options?.unique ? 'UNIQUE' : '';
        const method = options?.method || 'btree';

        const sql = `CREATE ${unique} INDEX IF NOT EXISTS ${indexName} ON ${table} USING ${method} (${columns.join(', ')})`;
        await this.execute(sql);
    }

    async dropIndex(table: string, indexName: string): Promise<void> {
        const sql = `DROP INDEX IF EXISTS ${indexName}`;
        await this.execute(sql);
    }

    async transaction<T>(fn: (client: any) => Promise<T>): Promise<T> {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const result = await fn(client);
            await client.query('COMMIT');
            return result;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async beginTransaction(): Promise<PoolClient> {
        const client = await this.pool.connect();
        await client.query('BEGIN');
        return client;
    }

    async commit(transaction: PoolClient): Promise<void> {
        await transaction.query('COMMIT');
        transaction.release();
    }

    async rollback(transaction: PoolClient): Promise<void> {
        await transaction.query('ROLLBACK');
        transaction.release();
    }

    async vectorSearch(embedding: number[], limit: number = 10, threshold?: number): Promise<any[]> {
        let sql = `
            SELECT *, embedding <=> $1::vector as distance
            FROM agent_memories
        `;

        const params: any[] = [embedding];

        if (threshold !== undefined) {
            sql += ` WHERE embedding <=> $1::vector < $2`;
            params.push(threshold);
        }

        sql += ` ORDER BY distance LIMIT ${limit}`;

        const result = await this.query(sql, params);
        return result.rows;
    }

    async hybridSearch(text: string, embedding: number[], options?: any): Promise<any[]> {
        const sql = `
            SELECT *,
                   ts_rank(to_tsvector('english', content), plainto_tsquery('english', $1)) as text_score,
                   embedding <=> $2::vector as vector_distance,
                   ((ts_rank(to_tsvector('english', content), plainto_tsquery('english', $1)) * ${options?.textWeight || 0.5}) +
                    ((1 - (embedding <=> $2::vector)) * ${options?.vectorWeight || 0.5})) as combined_score
            FROM agent_memories
            WHERE to_tsvector('english', content) @@ plainto_tsquery('english', $1)
               OR embedding <=> $2::vector < ${options?.threshold || 0.5}
            ORDER BY combined_score DESC
            LIMIT ${options?.limit || 20}
        `;

        const result = await this.query(sql, [text, embedding]);
        return result.rows;
    }

    async textSearch(text: string, table: string, columns: string[]): Promise<any[]> {
        const tsColumns = columns.map(col => `to_tsvector('english', ${col})`).join(' || ');

        const sql = `
            SELECT *, ts_rank(${tsColumns}, plainto_tsquery('english', $1)) as rank
            FROM ${table}
            WHERE ${tsColumns} @@ plainto_tsquery('english', $1)
            ORDER BY rank DESC
            LIMIT 50
        `;

        const result = await this.query(sql, [text]);
        return result.rows;
    }

    async migrate(migrations: MigrationFile[]): Promise<void> {
        const executed = await this.getMigrationHistory();

        for (const migration of migrations) {
            if (!executed.includes(migration.version)) {
                this.logger.info(`Running migration ${migration.version}: ${migration.name}`);

                await this.transaction(async (client) => {
                    await client.query(migration.up);
                    await client.query(
                        'INSERT INTO migration_history (version, name) VALUES ($1, $2)',
                        [migration.version, migration.name]
                    );
                });

                this.logger.info(`Migration ${migration.version} completed`);
            }
        }
    }

    async getMigrationHistory(): Promise<string[]> {
        const exists = await this.tableExists('migration_history');
        if (!exists) {
            return [];
        }

        const result = await this.query('SELECT version FROM migration_history ORDER BY executed_at');
        return result.rows.map(row => row.version);
    }

    async rollbackMigration(version: string): Promise<void> {
        throw new Error('Rollback not implemented yet');
    }

    async backup(path: string): Promise<void> {
        throw new Error('Backup not implemented yet');
    }

    async restore(path: string): Promise<void> {
        throw new Error('Restore not implemented yet');
    }

    async vacuum(): Promise<void> {
        await this.execute('VACUUM ANALYZE');
    }

    async analyze(table?: string): Promise<void> {
        if (table) {
            await this.execute(`ANALYZE ${table}`);
        } else {
            await this.execute('ANALYZE');
        }
    }
}