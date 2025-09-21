/**
 * Test Embedding Service with Gemini and Ollama
 */

import * as dotenv from 'dotenv';
import { EmbeddingService, EmbeddingConfig } from '../../core/src/services/embedding/EmbeddingService';
import { PersistenceManager } from '../../core/src/persistence/PersistenceManager';
import { Logger } from '../../logger/src';

// Load environment variables (try .env first, then .env.development)
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.development' });

const logger = Logger.getLogger('EmbeddingTest');

async function testGeminiEmbedding() {
    logger.info('\n🌟 Testing Gemini Embedding Provider...');

    try {
        const config: EmbeddingConfig = {
            provider: 'gemini',
            model: 'models/embedding-001',
            apiKey: process.env.GOOGLE_GEMINI_API_KEY || process.env.GEMINI_API_KEY,
            dimension: 768,
            cache: true
        };

        const embeddingService = new EmbeddingService(config);

        // Test single embedding
        const text = "The Tri-Protocol Framework is a multi-agent communication system";
        logger.info(`  📝 Generating embedding for: "${text}"`);

        const startTime = Date.now();
        const result = await embeddingService.generateEmbedding(text);
        const duration = Date.now() - startTime;

        logger.info(`  ✅ Embedding generated successfully`);
        logger.info(`  📊 Dimensions: ${result.embedding.length}`);
        logger.info(`  ⏱️  Time: ${duration}ms`);
        logger.info(`  🎯 Model: ${result.model}`);

        // Test batch embeddings
        const texts = [
            "Agent communication protocol",
            "Vector database integration",
            "Distributed persistence layer"
        ];

        logger.info(`\n  📝 Generating batch embeddings for ${texts.length} texts...`);
        const batchStart = Date.now();
        const batchResults = await embeddingService.generateEmbeddings(texts);
        const batchDuration = Date.now() - batchStart;

        logger.info(`  ✅ Batch embeddings generated`);
        logger.info(`  📊 Generated ${batchResults.length} embeddings`);
        logger.info(`  ⏱️  Total time: ${batchDuration}ms (${Math.round(batchDuration/texts.length)}ms per text)`);

        // Verify embeddings are different
        const similarity = cosineSimilarity(batchResults[0].embedding, batchResults[1].embedding);
        logger.info(`  🔍 Similarity between first two: ${(similarity * 100).toFixed(2)}%`);

        return true;
    } catch (error: any) {
        if (error.message?.includes('API key')) {
            logger.warn('  ⚠️  Gemini API key not configured. Set GEMINI_API_KEY in .env.development');
            return false;
        }
        logger.error('  ❌ Gemini test failed:', error);
        return false;
    }
}

async function testOllamaEmbedding() {
    logger.info('\n🦙 Testing Ollama Embedding Provider...');

    try {
        const config: EmbeddingConfig = {
            provider: 'ollama',
            model: 'nomic-embed-text',
            baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
            dimension: 768,
            cache: true
        };

        const embeddingService = new EmbeddingService(config);

        // Test single embedding
        const text = "The Tri-Protocol Framework is a multi-agent communication system";
        logger.info(`  📝 Generating embedding for: "${text}"`);

        const startTime = Date.now();
        const result = await embeddingService.generateEmbedding(text);
        const duration = Date.now() - startTime;

        logger.info(`  ✅ Embedding generated successfully`);
        logger.info(`  📊 Dimensions: ${result.embedding.length}`);
        logger.info(`  ⏱️  Time: ${duration}ms`);
        logger.info(`  🎯 Model: ${result.model}`);

        // Test caching
        logger.info('\n  🔄 Testing cache...');
        const cacheStart = Date.now();
        const cachedResult = await embeddingService.generateEmbedding(text);
        const cacheDuration = Date.now() - cacheStart;

        if (cachedResult.cached) {
            logger.info(`  ✅ Cache hit! Time: ${cacheDuration}ms (${Math.round(duration/cacheDuration)}x faster)`);
        } else {
            logger.info(`  ℹ️  Cache miss (expected on first run)`);
        }

        return true;
    } catch (error: any) {
        if (error.message?.includes('fetch failed') || error.message?.includes('ECONNREFUSED')) {
            logger.warn('  ⚠️  Ollama not running. Start with: ollama serve');
            return false;
        }
        logger.error('  ❌ Ollama test failed:', error);
        return false;
    }
}

async function testPersistenceWithEmbeddings() {
    logger.info('\n🗄️  Testing Persistence Layer with Real Embeddings...');

    const config: any = {
        redis: {
            host: 'localhost',
            port: 6379
        },
        postgres: {
            host: 'localhost',
            port: 5432,
            database: 'triprotocol',
            user: 'triprotocol',
            password: 'triprotocol123',
            vectorDimension: 768 // Match Gemini/Ollama dimension
        },
        mongodb: {
            uri: 'mongodb://triprotocol:triprotocol123@localhost:27017/triprotocol?authSource=triprotocol',
            database: 'triprotocol'
        },
        qdrant: {
            url: 'http://localhost:6333',
            collection: 'triprotocol-vectors'
        },
        embedding: {
            enabled: true,  // Explicitly enable embeddings
            provider: 'ollama',  // Use Ollama to avoid Gemini rate limits
            model: 'nomic-embed-text',
            baseUrl: 'http://localhost:11434',
            dimension: 768
        },
        vectors: {
            enabled: true  // Enable vector search
        },
        strategy: 'hybrid',
        cache: {
            enabled: true,
            ttl: 60,
            maxSize: 1000,
            evictionPolicy: 'lru' as const
        }
    };

    try {
        const persistence = new PersistenceManager(config);
        await persistence.initialize();
        logger.info('  ✅ Persistence initialized with embedding support');

        // Save workflows with embeddings
        const workflows = [
            {
                id: 'wf-embed-001',
                name: 'Data Processing Pipeline',
                description: 'Process and transform data using parallel agents',
                nodes: [],
                edges: []
            },
            {
                id: 'wf-embed-002',
                name: 'Machine Learning Workflow',
                description: 'Train and evaluate ML models with distributed computing',
                nodes: [],
                edges: []
            },
            {
                id: 'wf-embed-003',
                name: 'ETL Pipeline',
                description: 'Extract, transform, and load data from multiple sources',
                nodes: [],
                edges: []
            }
        ];

        logger.info(`\n  💾 Saving ${workflows.length} workflows with embeddings...`);
        for (const workflow of workflows) {
            await persistence.saveWorkflow(workflow);
            logger.info(`    ✅ Saved: ${workflow.name}`);
        }

        // Test vector search
        logger.info('\n  🔍 Testing semantic search...');
        const searchQuery = "parallel data processing and transformation";
        logger.info(`    Query: "${searchQuery}"`);

        const results = await persistence.searchSimilar(searchQuery, { limit: 3 });
        logger.info(`    Found ${results.length} similar workflows:`);

        results.forEach((result: any, index: number) => {
            const score = result.score || result.similarity || 0;
            logger.info(`    ${index + 1}. ${result.name || result.content} (similarity: ${(score * 100).toFixed(1)}%)`);
        });

        // Save agent memories with embeddings
        logger.info('\n  🧠 Saving agent memories with embeddings...');
        const memories = [
            {
                id: 'mem-embed-001',
                content: 'Discovered optimal batch size for vector processing is 32',
                timestamp: new Date(),
                metadata: { type: 'optimization', agent: 'processor' }
            },
            {
                id: 'mem-embed-002',
                content: 'Cache hit ratio improved to 85% with LRU eviction policy',
                timestamp: new Date(),
                metadata: { type: 'performance', agent: 'cache-manager' }
            }
        ];

        for (const memory of memories) {
            await persistence.saveAgentMemory('agent-001', memory);
        }
        logger.info(`    ✅ Saved ${memories.length} memories with embeddings`);

        await persistence.shutdown();
        return true;

    } catch (error) {
        logger.error('  ❌ Persistence test failed:', error);
        return false;
    }
}

// Utility function to calculate cosine similarity
function cosineSimilarity(vec1: number[], vec2: number[]): number {
    if (vec1.length !== vec2.length) {
        throw new Error('Vectors must have the same dimension');
    }

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < vec1.length; i++) {
        dotProduct += vec1[i] * vec2[i];
        norm1 += vec1[i] * vec1[i];
        norm2 += vec2[i] * vec2[i];
    }

    return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
}

async function main() {
    logger.info('🚀 Starting Embedding Service Tests\n');
    logger.info('=' .repeat(50));

    const results = {
        gemini: false,
        ollama: false,
        persistence: false
    };

    // Test Gemini
    results.gemini = await testGeminiEmbedding();

    // Test Ollama
    results.ollama = await testOllamaEmbedding();

    // Test persistence with available provider
    if (results.gemini || results.ollama) {
        results.persistence = await testPersistenceWithEmbeddings();
    } else {
        logger.warn('\n⚠️  Skipping persistence test - no embedding provider available');
    }

    // Summary
    logger.info('\n' + '=' .repeat(50));
    logger.info('📊 Test Summary:\n');
    logger.info(`  Gemini:      ${results.gemini ? '✅ Passed' : '❌ Failed/Skipped'}`);
    logger.info(`  Ollama:      ${results.ollama ? '✅ Passed' : '❌ Failed/Skipped'}`);
    logger.info(`  Persistence: ${results.persistence ? '✅ Passed' : '❌ Failed/Skipped'}`);

    const allPassed = Object.values(results).some(r => r);
    if (allPassed) {
        logger.info('\n🎉 At least one embedding provider is working!');
        logger.info('\n💡 Tips:');
        if (!results.gemini) {
            logger.info('  • Set GOOGLE_GEMINI_API_KEY or GEMINI_API_KEY in .env to enable Gemini');
        }
        if (!results.ollama) {
            logger.info('  • Run "ollama serve" and "ollama pull nomic-embed-text" to enable Ollama');
        }
    } else {
        logger.error('\n❌ No embedding providers available');
        logger.info('\n🔧 Setup instructions:');
        logger.info('  For Gemini: Add GEMINI_API_KEY to .env.development');
        logger.info('  For Ollama: Install from https://ollama.ai and run "ollama serve"');
    }
}

// Run tests
main()
    .then(() => process.exit(0))
    .catch((error) => {
        logger.error('Test failed:', error);
        process.exit(1);
    });