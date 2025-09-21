import { MigrationFile } from '../../../interfaces/IRelationalAdapter';

export const migrations: MigrationFile[] = [
    {
        version: '001',
        name: 'initial_schema',
        up: `
            CREATE EXTENSION IF NOT EXISTS vector;

            CREATE TABLE IF NOT EXISTS workflows (
                id VARCHAR(255) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                definition JSONB NOT NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW(),
                version INTEGER DEFAULT 1,
                metadata JSONB
            );

            CREATE TABLE IF NOT EXISTS agents (
                id VARCHAR(255) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                type VARCHAR(100),
                capabilities TEXT[],
                configuration JSONB,
                status VARCHAR(50) DEFAULT 'active',
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS agent_memories (
                id SERIAL PRIMARY KEY,
                agent_id VARCHAR(255) NOT NULL,
                content TEXT NOT NULL,
                embedding vector(1536),
                timestamp TIMESTAMP DEFAULT NOW(),
                metadata JSONB,
                UNIQUE(agent_id, timestamp)
            );

            CREATE TABLE IF NOT EXISTS execution_history (
                id VARCHAR(255) PRIMARY KEY,
                workflow_id VARCHAR(255) REFERENCES workflows(id),
                status VARCHAR(50) NOT NULL,
                started_at TIMESTAMP NOT NULL,
                ended_at TIMESTAMP,
                metrics JSONB,
                created_at TIMESTAMP DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS messages (
                id VARCHAR(255) PRIMARY KEY,
                from_agent VARCHAR(255),
                to_agent VARCHAR(255),
                content TEXT,
                embedding vector(1536),
                timestamp TIMESTAMP DEFAULT NOW(),
                metadata JSONB
            );

            CREATE TABLE IF NOT EXISTS tasks (
                id VARCHAR(255) PRIMARY KEY,
                workflow_id VARCHAR(255) REFERENCES workflows(id),
                agent_id VARCHAR(255) REFERENCES agents(id),
                status VARCHAR(50) DEFAULT 'pending',
                priority INTEGER DEFAULT 0,
                input JSONB,
                output JSONB,
                created_at TIMESTAMP DEFAULT NOW(),
                started_at TIMESTAMP,
                completed_at TIMESTAMP
            );
        `,
        down: `
            DROP TABLE IF EXISTS tasks CASCADE;
            DROP TABLE IF EXISTS messages CASCADE;
            DROP TABLE IF EXISTS execution_history CASCADE;
            DROP TABLE IF EXISTS agent_memories CASCADE;
            DROP TABLE IF EXISTS agents CASCADE;
            DROP TABLE IF EXISTS workflows CASCADE;
            DROP EXTENSION IF EXISTS vector;
        `
    },
    {
        version: '002',
        name: 'add_indexes',
        up: `
            CREATE INDEX IF NOT EXISTS idx_workflows_name ON workflows(name);
            CREATE INDEX IF NOT EXISTS idx_workflows_created_at ON workflows(created_at DESC);

            CREATE INDEX IF NOT EXISTS idx_agents_name ON agents(name);
            CREATE INDEX IF NOT EXISTS idx_agents_type ON agents(type);
            CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);

            CREATE INDEX IF NOT EXISTS idx_embedding_ivfflat
            ON agent_memories
            USING ivfflat (embedding vector_cosine_ops)
            WITH (lists = 100);

            CREATE INDEX IF NOT EXISTS idx_messages_embedding
            ON messages
            USING ivfflat (embedding vector_cosine_ops)
            WITH (lists = 100);

            CREATE INDEX IF NOT EXISTS idx_execution_workflow_id ON execution_history(workflow_id);
            CREATE INDEX IF NOT EXISTS idx_execution_status ON execution_history(status);
            CREATE INDEX IF NOT EXISTS idx_execution_started_at ON execution_history(started_at DESC);

            CREATE INDEX IF NOT EXISTS idx_tasks_workflow_id ON tasks(workflow_id);
            CREATE INDEX IF NOT EXISTS idx_tasks_agent_id ON tasks(agent_id);
            CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
            CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at DESC);
        `,
        down: `
            DROP INDEX IF EXISTS idx_tasks_created_at;
            DROP INDEX IF EXISTS idx_tasks_status;
            DROP INDEX IF EXISTS idx_tasks_agent_id;
            DROP INDEX IF EXISTS idx_tasks_workflow_id;
            DROP INDEX IF EXISTS idx_execution_started_at;
            DROP INDEX IF EXISTS idx_execution_status;
            DROP INDEX IF EXISTS idx_execution_workflow_id;
            DROP INDEX IF EXISTS idx_messages_embedding;
            DROP INDEX IF EXISTS idx_embedding_ivfflat;
            DROP INDEX IF EXISTS idx_agents_status;
            DROP INDEX IF EXISTS idx_agents_type;
            DROP INDEX IF EXISTS idx_agents_name;
            DROP INDEX IF EXISTS idx_workflows_created_at;
            DROP INDEX IF EXISTS idx_workflows_name;
        `
    }
];