import { PersistenceManager, PersistenceConfig } from '../core/src/persistence/PersistenceManager';

async function main() {
    // Configure the persistence layer with all backends
    const config: PersistenceConfig = {
        redis: {
            host: process.env.REDIS_HOST || 'localhost',
            port: parseInt(process.env.REDIS_PORT || '6379'),
            password: process.env.REDIS_PASSWORD
        },

        postgres: {
            host: process.env.POSTGRES_HOST || 'localhost',
            port: parseInt(process.env.POSTGRES_PORT || '5432'),
            user: process.env.POSTGRES_USER || 'triprotocol',
            password: process.env.POSTGRES_PASSWORD || 'password',
            database: process.env.POSTGRES_DB || 'triprotocol',
            vectorDimension: 1536,
            indexMethod: 'ivfflat'
        },

        mongodb: {
            uri: process.env.MONGODB_URI || 'mongodb://localhost:27017',
            database: 'triprotocol',
            options: {
                useUnifiedTopology: true
            }
        },

        qdrant: {
            url: process.env.QDRANT_URL || 'http://localhost:6333',
            apiKey: process.env.QDRANT_API_KEY,
            collection: 'triprotocol-vectors',
            vectorSize: 1536,
            distance: 'Cosine'
        },

        strategy: 'hybrid',

        cache: {
            enabled: true,
            ttl: 3600,
            maxSize: 1024 * 1024 * 100,
            evictionPolicy: 'lru'
        },

        vectors: {
            enabled: true,
            dimensions: 1536,
            model: 'text-embedding-ada-002'
        }
    };

    // Initialize the persistence manager
    const persistence = new PersistenceManager(config);
    await persistence.initialize();

    console.log('✅ Persistence layer initialized successfully');

    // Example 1: Save a workflow
    const workflow = {
        id: 'workflow-001',
        name: 'Data Processing Pipeline',
        description: 'Processes incoming data through multiple stages',
        version: 1,
        nodes: [
            { id: 'start', type: 'input' },
            { id: 'process', type: 'transform' },
            { id: 'end', type: 'output' }
        ],
        edges: [
            { from: 'start', to: 'process' },
            { from: 'process', to: 'end' }
        ]
    };

    await persistence.saveWorkflow(workflow);
    console.log('✅ Workflow saved');

    // Example 2: Save an execution
    const execution = {
        id: 'exec-001',
        workflowId: 'workflow-001',
        status: 'running' as const,
        currentNode: 'process',
        startTime: new Date(),
        state: {
            processedItems: 100,
            errors: 0
        },
        metrics: {
            duration: 1500,
            memory: 256
        }
    };

    await persistence.saveExecution(execution);
    console.log('✅ Execution saved');

    // Example 3: Save agent memory
    const memory = {
        id: 'memory-001',
        content: 'The user requested help with data processing. They need to transform CSV data into JSON format.',
        timestamp: new Date(),
        metadata: {
            topic: 'data-transformation',
            sentiment: 'neutral'
        }
    };

    await persistence.saveAgentMemory('agent-001', memory);
    console.log('✅ Agent memory saved');

    // Example 4: Search for similar content
    const searchResults = await persistence.searchSimilar(
        'How to convert CSV to JSON',
        { limit: 5 }
    );
    console.log(`✅ Found ${searchResults.length} similar results`);

    // Example 5: Query workflows with filters
    const workflows = await persistence.queryWorkflows({
        filters: { name: 'Data Processing Pipeline' }
    });
    console.log(`✅ Found ${workflows.length} workflows`);

    // Example 6: Use caching
    const cachedWorkflow = await persistence.getCached('workflow:workflow-001');
    if (cachedWorkflow) {
        console.log('✅ Retrieved workflow from cache');
    }

    // Example 7: Run database migrations
    await persistence.runMigrations();
    console.log('✅ Migrations completed');

    // Example 8: Transaction example (PostgreSQL only)
    try {
        await persistence.transaction(async () => {
            // All operations in here will be part of the transaction
            await persistence.saveWorkflow({
                ...workflow,
                id: 'workflow-002',
                name: 'Transactional Workflow'
            });

            // If any operation fails, all will be rolled back
            await persistence.saveExecution({
                ...execution,
                id: 'exec-002',
                workflowId: 'workflow-002'
            });
        });
        console.log('✅ Transaction completed successfully');
    } catch (error) {
        console.error('❌ Transaction rolled back:', error);
    }

    // Cleanup
    await persistence.shutdown();
    console.log('✅ Persistence layer shut down');
}

// Run the example
main().catch(console.error);