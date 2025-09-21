import * as dotenv from 'dotenv';
import { PersistenceManager, PersistenceConfig } from '../core/src/persistence/PersistenceManager';
import { HealthCheckService } from '../core/src/services/health/HealthCheckService';
// @ts-ignore
import { Logger } from '@tri-protocol/logger';

// Load environment variables
dotenv.config({ path: '.env.development' });

const logger = Logger.getLogger('PersistenceExample');

async function main() {
    // First, check if all services are healthy
    logger.info('🏥 Checking service health...');

    const healthService = new HealthCheckService({
        enabled: true,
        services: {
            redis: {
                host: process.env.REDIS_HOST || 'localhost',
                port: parseInt(process.env.REDIS_PORT || '6379')
            },
            postgres: {
                host: process.env.POSTGRES_HOST || 'localhost',
                port: parseInt(process.env.POSTGRES_PORT || '5432'),
                user: process.env.POSTGRES_USER || 'triprotocol',
                password: process.env.POSTGRES_PASSWORD || 'triprotocol123',
                database: process.env.POSTGRES_DB || 'triprotocol'
            },
            mongodb: {
                uri: process.env.MONGODB_URI || 'mongodb://triprotocol:triprotocol123@localhost:27017/triprotocol?authSource=triprotocol'
            },
            qdrant: {
                url: process.env.QDRANT_URL || 'http://localhost:6333'
            }
        }
    });

    const health = await healthService.performHealthCheck();
    console.log('\n📊 Service Health Status:');
    health.services.forEach(service => {
        const icon = service.status === 'healthy' ? '✅' : '❌';
        console.log(`  ${icon} ${service.name}: ${service.status} - ${service.message}`);
        if (service.latency) {
            console.log(`     Latency: ${service.latency}ms`);
        }
    });

    if (health.status !== 'healthy') {
        logger.error('⚠️  Not all services are healthy. Please run: npm run services:start');
        process.exit(1);
    }

    logger.info('\n🚀 All services healthy! Starting persistence example...\n');

    // Configure persistence with real embeddings
    const persistenceConfig: PersistenceConfig = {
        redis: {
            host: process.env.REDIS_HOST || 'localhost',
            port: parseInt(process.env.REDIS_PORT || '6379'),
            password: process.env.REDIS_PASSWORD
        },

        postgres: {
            host: process.env.POSTGRES_HOST || 'localhost',
            port: parseInt(process.env.POSTGRES_PORT || '5432'),
            user: process.env.POSTGRES_USER || 'triprotocol',
            password: process.env.POSTGRES_PASSWORD || 'triprotocol123',
            database: process.env.POSTGRES_DB || 'triprotocol',
            vectorDimension: 1536,
            indexMethod: 'ivfflat'
        },

        mongodb: {
            uri: process.env.MONGODB_URI || 'mongodb://triprotocol:triprotocol123@localhost:27017/triprotocol?authSource=triprotocol',
            database: 'triprotocol'
        },

        qdrant: {
            url: process.env.QDRANT_URL || 'http://localhost:6333',
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
        },

        // Real embedding configuration
        embedding: {
            provider: process.env.OPENAI_API_KEY ? 'openai' : 'ollama',
            model: process.env.EMBEDDING_MODEL || 'text-embedding-ada-002',
            apiKey: process.env.OPENAI_API_KEY,
            baseUrl: process.env.OLLAMA_BASE_URL,
            cache: true
        }
    };

    const persistence = new PersistenceManager(persistenceConfig);
    await persistence.initialize();

    logger.info('✅ Persistence layer initialized with embedding support');

    // Example 1: Create and save workflows with semantic descriptions
    const workflows = [
        {
            id: 'wf-data-processing',
            name: 'Data Processing Pipeline',
            description: 'Processes CSV files by parsing, validating, transforming to JSON format, and storing in a database',
            version: 1,
            nodes: [
                { id: 'input', type: 'file-reader', config: { format: 'csv' } },
                { id: 'validate', type: 'validator', config: { schema: 'user-data' } },
                { id: 'transform', type: 'transformer', config: { output: 'json' } },
                { id: 'store', type: 'database-writer', config: { table: 'processed_data' } }
            ],
            edges: [
                { from: 'input', to: 'validate' },
                { from: 'validate', to: 'transform' },
                { from: 'transform', to: 'store' }
            ]
        },
        {
            id: 'wf-ml-training',
            name: 'Machine Learning Training Pipeline',
            description: 'Train a neural network model on image data with data augmentation and hyperparameter tuning',
            version: 1,
            nodes: [
                { id: 'load', type: 'data-loader' },
                { id: 'augment', type: 'image-augmentation' },
                { id: 'train', type: 'model-training' },
                { id: 'evaluate', type: 'model-evaluation' }
            ],
            edges: [
                { from: 'load', to: 'augment' },
                { from: 'augment', to: 'train' },
                { from: 'train', to: 'evaluate' }
            ]
        },
        {
            id: 'wf-web-scraping',
            name: 'Web Scraping Pipeline',
            description: 'Scrape e-commerce websites for product prices, extract structured data, and monitor price changes',
            version: 1,
            nodes: [
                { id: 'fetch', type: 'web-fetcher' },
                { id: 'parse', type: 'html-parser' },
                { id: 'extract', type: 'data-extractor' },
                { id: 'compare', type: 'price-comparator' }
            ],
            edges: [
                { from: 'fetch', to: 'parse' },
                { from: 'parse', to: 'extract' },
                { from: 'extract', to: 'compare' }
            ]
        }
    ];

    logger.info('\n📝 Saving workflows with embeddings...');
    for (const workflow of workflows) {
        await persistence.saveWorkflow(workflow);
        logger.info(`  ✅ Saved: ${workflow.name}`);
    }

    // Example 2: Save agent memories with semantic content
    const agentMemories = [
        {
            id: 'mem-001',
            content: 'User requested help with converting CSV files to JSON format. They have a large dataset of customer information.',
            timestamp: new Date(),
            metadata: { topic: 'data-conversion', importance: 'high' }
        },
        {
            id: 'mem-002',
            content: 'The machine learning model achieved 95% accuracy on the test dataset after 50 epochs of training.',
            timestamp: new Date(),
            metadata: { topic: 'ml-training', importance: 'medium' }
        },
        {
            id: 'mem-003',
            content: 'Price monitoring detected a 20% drop in product XYZ on the competitor website.',
            timestamp: new Date(),
            metadata: { topic: 'price-monitoring', importance: 'high' }
        }
    ];

    logger.info('\n💭 Saving agent memories with embeddings...');
    for (const memory of agentMemories) {
        await persistence.saveAgentMemory('agent-001', memory);
        logger.info(`  ✅ Saved memory: ${memory.content.substring(0, 50)}...`);
    }

    // Example 3: Semantic search
    const searchQueries = [
        'How to process CSV data and transform it to JSON?',
        'What is the accuracy of our machine learning model?',
        'Show me workflows related to data transformation',
        'Find information about price monitoring and web scraping'
    ];

    logger.info('\n🔍 Performing semantic searches...');
    for (const query of searchQueries) {
        logger.info(`\n  Query: "${query}"`);
        const results = await persistence.searchSimilar(query, { limit: 3 });

        if (results.length > 0) {
            logger.info(`  Found ${results.length} results:`);
            results.forEach((result, index) => {
                logger.info(`    ${index + 1}. Score: ${result.score.toFixed(3)} - ${JSON.stringify(result.payload).substring(0, 100)}...`);
            });
        } else {
            logger.info('  No results found');
        }
    }

    // Example 4: Query workflows with different strategies
    logger.info('\n📊 Querying workflows...');

    // Structured query
    const structuredResults = await persistence.queryWorkflows({
        filters: { name: 'Data Processing Pipeline' }
    });
    logger.info(`  Structured query found: ${structuredResults.length} workflows`);

    // Semantic query
    const semanticResults = await persistence.queryWorkflows({
        semantic: 'workflows for processing and transforming data'
    });
    logger.info(`  Semantic query found: ${semanticResults.length} workflows`);

    // Example 5: Check cache statistics
    const cacheStats = {
        workflow_cached: await persistence.getCached('workflow:wf-data-processing'),
        cache_hits: 0,
        cache_misses: 0
    };

    // Try to get cached items (should be fast)
    const startCache = Date.now();
    await persistence.getCached('workflow:wf-data-processing');
    await persistence.getCached('workflow:wf-ml-training');
    const cacheTime = Date.now() - startCache;

    logger.info('\n⚡ Cache Performance:');
    logger.info(`  Cache retrieval time: ${cacheTime}ms`);
    logger.info(`  Cached workflows: ${workflows.filter(w => cacheStats.workflow_cached).length}`);

    // Example 6: Monitor executions in real-time
    logger.info('\n🎬 Simulating workflow execution...');

    const execution: any = {
        id: 'exec-demo-001',
        workflowId: 'wf-data-processing',
        status: 'running',
        currentNode: 'input',
        startTime: new Date(),
        state: {
            processedRows: 0,
            errors: []
        },
        metrics: {
            startupTime: 150,
            memoryUsage: 128
        }
    };

    await persistence.saveExecution(execution);
    logger.info('  ▶️  Execution started');

    // Simulate progress
    for (const node of ['validate', 'transform', 'store']) {
        await new Promise(resolve => setTimeout(resolve, 500));
        execution.currentNode = node;
        execution.state.processedRows += 1000;
        await persistence.saveExecution(execution);
        logger.info(`  ⚙️  Processing node: ${node} (${execution.state.processedRows} rows processed)`);
    }

    execution.status = 'completed';
    execution.endTime = new Date();
    execution.metrics = {
        ...execution.metrics,
        totalDuration: Date.now() - execution.startTime.getTime(),
        finalMemoryUsage: 256,
        rowsProcessed: execution.state.processedRows
    };

    await persistence.saveExecution(execution);
    logger.info('  ✅ Execution completed');

    // Final statistics
    logger.info('\n📈 Final Statistics:');
    logger.info(`  • Workflows saved: ${workflows.length}`);
    logger.info(`  • Agent memories saved: ${agentMemories.length}`);
    logger.info(`  • Semantic searches performed: ${searchQueries.length}`);
    logger.info(`  • Execution time: ${execution.metrics.totalDuration}ms`);

    // Cleanup
    await persistence.shutdown();
    await healthService.stop();

    logger.info('\n✨ Example completed successfully!');
}

// Run the example
main().catch(error => {
    logger.error('Example failed:', error);
    process.exit(1);
});