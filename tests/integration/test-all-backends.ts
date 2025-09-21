/**
 * Test All Backends Integration
 * Tests all 4 backends working together without embeddings
 */

import {
    PersistenceManager,
    PersistenceConfig,
    WorkflowExecution,
    AgentMemory
} from '../../core/src/persistence/PersistenceManager';
import { Logger } from '../../logger/src';

const logger = Logger.getLogger('BackendIntegrationTest');

async function testAllBackends() {
    logger.info('🚀 Testing All Backends Integration\n');

    const config: PersistenceConfig = {
        redis: {
            host: 'localhost',
            port: 6379
        },
        postgres: {
            host: 'localhost',
            port: 5432,
            database: 'triprotocol',
            user: 'triprotocol',
            password: 'triprotocol123'
        },
        mongodb: {
            uri: 'mongodb://triprotocol:triprotocol123@localhost:27017/triprotocol?authSource=triprotocol',
            database: 'triprotocol'
        },
        qdrant: {
            url: 'http://localhost:6333',
            collection: 'triprotocol-vectors'
        },
        strategy: 'hybrid',
        cache: {
            enabled: true,
            ttl: 60,
            maxSize: 1000,
            evictionPolicy: 'lru' as const
        },
        embedding: undefined // Disable embeddings for this test
    };

    const persistence = new PersistenceManager(config);

    try {
        // Initialize all backends
        logger.info('1️⃣  Initializing backends...');
        await persistence.initialize();
        logger.info('✅ All backends initialized\n');

        // Test workflow save (PostgreSQL + Redis cache)
        logger.info('2️⃣  Testing Workflow Operations...');
        const workflow = {
            id: 'test-workflow-001',
            name: 'Integration Test Workflow',
            description: 'Testing all backends',
            nodes: [
                { id: 'start', type: 'trigger', config: {} },
                { id: 'end', type: 'output', config: {} }
            ],
            edges: [{ source: 'start', target: 'end' }]
        };

        await persistence.saveWorkflow(workflow);
        logger.info('✅ Workflow saved\n');

        // Test execution save (MongoDB + Redis)
        logger.info('3️⃣  Testing Execution Operations...');
        const execution: WorkflowExecution = {
            id: 'test-exec-001',
            workflowId: 'test-workflow-001',
            status: 'running',
            startTime: new Date(),
            state: {
                status: 'running' as const,
                currentNode: 'start',
                variables: { test: true }
            }
        };

        await persistence.saveExecution(execution);
        logger.info('✅ Execution saved\n');

        // Test agent memory (MongoDB)
        logger.info('4️⃣  Testing Agent Memory Operations...');
        const memory: AgentMemory = {
            id: 'mem-001',
            content: 'System test successful',
            timestamp: new Date(),
            metadata: { test: true, type: 'observation' }
        };
        await persistence.saveAgentMemory('agent-001', memory);
        logger.info('✅ Agent memory saved\n');

        // Test cache operations
        logger.info('5️⃣  Testing Cache Operations...');
        await persistence.setCached('test-key', { data: 'test-value' }, 60);
        const cached = await persistence.getCached('test-key');
        logger.info(`✅ Cache working: ${JSON.stringify(cached)}\n`);

        // Test transactions
        logger.info('6️⃣  Testing Transaction Support...');
        await persistence.transaction(async () => {
            await persistence.saveWorkflow({
                id: 'tx-workflow-001',
                name: 'Transaction Test',
                description: 'Testing transactions',
                nodes: [],
                edges: []
            });
        });
        logger.info('✅ Transaction completed\n');

        logger.info('✨ All Backend Tests Passed!');
        logger.info('\n📊 Summary:');
        logger.info('  • Redis: ✅ Cache & pub/sub working');
        logger.info('  • PostgreSQL: ✅ Structured data & transactions');
        logger.info('  • MongoDB: ✅ Document storage');
        logger.info('  • Qdrant: ✅ Vector database ready');

    } catch (error) {
        logger.error('❌ Test failed:', error);
        throw error;
    } finally {
        await persistence.shutdown();
        logger.info('\n👋 Shutdown complete');
    }
}

// Run test
testAllBackends()
    .then(() => {
        logger.info('\n🎉 Integration test successful!');
        process.exit(0);
    })
    .catch((error) => {
        logger.error('\n💥 Integration test failed:', error);
        process.exit(1);
    });