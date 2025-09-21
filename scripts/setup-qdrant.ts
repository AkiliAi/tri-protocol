import { QdrantClient } from '@qdrant/js-client-rest';
// @ts-ignore
import { Logger } from '@tri-protocol/logger';

const logger = Logger.getLogger('QdrantSetup');

async function setupQdrant() {
    logger.info('🚀 Setting up Qdrant collections...\n');

    const client = new QdrantClient({
        url: process.env.QDRANT_URL || 'http://localhost:6333',
        apiKey: process.env.QDRANT_API_KEY
    });

    const collectionName = 'triprotocol-vectors';

    try {
        // Check if collection exists
        logger.info('Checking existing collections...');
        const collections = await client.getCollections();
        const exists = collections.collections.some(c => c.name === collectionName);

        if (exists) {
            logger.info(`Collection '${collectionName}' already exists. Deleting...`);
            await client.deleteCollection(collectionName);
            logger.info('✅ Existing collection deleted');
        }

        // Create new collection with proper configuration
        logger.info(`\nCreating collection '${collectionName}'...`);
        await client.createCollection(collectionName, {
            vectors: {
                size: 768, // Ollama nomic-embed-text / Gemini embedding size
                distance: 'Cosine'
            },
            optimizers_config: {
                default_segment_number: 2,
                indexing_threshold: 20000
            },
            wal_config: {
                wal_capacity_mb: 32,
                wal_segments_ahead: 0
            },
            replication_factor: 1,
            write_consistency_factor: 1,
            on_disk_payload: false,
            shard_number: 1,
            quantization_config: {
                scalar: {
                    type: 'int8',
                    quantile: 0.99,
                    always_ram: true
                }
            }
        });

        logger.info('✅ Collection created successfully');

        // Verify collection
        const collectionInfo = await client.getCollection(collectionName);
        logger.info('\n📊 Collection Info:');
        logger.info(`  • Name: ${collectionName}`);
        logger.info(`  • Vector size: ${collectionInfo.config?.params?.vectors?.size || 1536}`);
        logger.info(`  • Distance: ${collectionInfo.config?.params?.vectors?.distance || 'Cosine'}`);
        logger.info(`  • Points count: ${collectionInfo.points_count || 0}`);
        logger.info(`  • Status: ${collectionInfo.status || 'green'}`);

        // Create payload indexes for better search performance
        logger.info('\nCreating payload indexes...');

        // Index for type field (workflow, memory, message, etc.)
        await client.createPayloadIndex(collectionName, {
            field_name: 'type',
            field_schema: 'keyword',
            wait: true
        });

        // Index for agent_id field
        await client.createPayloadIndex(collectionName, {
            field_name: 'agent_id',
            field_schema: 'keyword',
            wait: true
        });

        // Index for timestamp field
        await client.createPayloadIndex(collectionName, {
            field_name: 'timestamp',
            field_schema: 'datetime',
            wait: true
        });

        logger.info('✅ Payload indexes created');

        // Test with a sample point
        logger.info('\n🧪 Testing with sample vector...');

        // Qdrant expects UUID or integer IDs
        const testPoint = {
            id: 1, // Use integer ID for testing
            vector: Array(768).fill(0).map(() => Math.random()),
            payload: {
                type: 'test',
                content: 'Test vector for Qdrant setup',
                timestamp: new Date().toISOString()
            }
        };

        await client.upsert(collectionName, {
            wait: true,
            points: [testPoint]
        });

        logger.info('✅ Test vector inserted successfully');

        // Search for the test vector
        const searchResult = await client.search(collectionName, {
            vector: testPoint.vector,
            limit: 1,
            with_payload: true
        });

        if (searchResult.length > 0 && searchResult[0].id === 1) {
            logger.info('✅ Search test passed');
        }

        // Clean up test data
        await client.delete(collectionName, {
            wait: true,
            points: [1]
        });

        logger.info('✅ Test data cleaned up');

        logger.info('\n✨ Qdrant setup completed successfully!');
        logger.info(`\n📌 Collection '${collectionName}' is ready for use`);
        logger.info('   URL: http://localhost:6333');
        logger.info('   Dashboard: http://localhost:6333/dashboard');

    } catch (error) {
        logger.error('❌ Qdrant setup failed:', error);
        process.exit(1);
    }
}

// Run setup
setupQdrant().catch(console.error);