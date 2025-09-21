import { EventEmitter } from 'eventemitter3';
// @ts-ignore
import { Logger } from '@tri-protocol/logger';

export interface EmbeddingConfig {
    provider: 'openai' | 'anthropic' | 'cohere' | 'huggingface' | 'ollama' | 'gemini';
    model?: string;
    apiKey?: string;
    baseUrl?: string;
    dimension?: number;
    batchSize?: number;
    maxRetries?: number;
    timeout?: number;
    cache?: boolean;
}

export interface EmbeddingResult {
    embedding: number[];
    model: string;
    usage?: {
        prompt_tokens: number;
        total_tokens: number;
    };
    cached?: boolean;
}

export interface EmbeddingProvider {
    name: string;
    generateEmbedding(text: string): Promise<number[]>;
    generateEmbeddings(texts: string[]): Promise<number[][]>;
    getDimension(): number;
    getModel(): string;
}

export class EmbeddingService extends EventEmitter {
    private provider: EmbeddingProvider;
    private logger: Logger;
    private cache: Map<string, number[]> = new Map();
    private config: EmbeddingConfig;

    constructor(config: EmbeddingConfig) {
        super();
        this.config = config;
        this.logger = Logger.getLogger('EmbeddingService');
        this.provider = this.createProvider(config);
    }

    private createProvider(config: EmbeddingConfig): EmbeddingProvider {
        switch (config.provider) {
            case 'openai':
                return new OpenAIEmbeddingProvider(config);
            case 'anthropic':
                return new AnthropicEmbeddingProvider(config);
            case 'cohere':
                return new CohereEmbeddingProvider(config);
            case 'huggingface':
                return new HuggingFaceEmbeddingProvider(config);
            case 'ollama':
                return new OllamaEmbeddingProvider(config);
            case 'gemini':
                return new GeminiEmbeddingProvider(config);
            default:
                throw new Error(`Unsupported embedding provider: ${config.provider}`);
        }
    }

    async generateEmbedding(text: string): Promise<EmbeddingResult> {
        const startTime = Date.now();

        try {
            // Check cache if enabled
            if (this.config.cache) {
                const cacheKey = this.getCacheKey(text);
                const cached = this.cache.get(cacheKey);
                if (cached) {
                    this.emit('embedding:cached', { text: text.substring(0, 100) });
                    return {
                        embedding: cached,
                        model: this.provider.getModel(),
                        cached: true
                    };
                }
            }

            // Generate embedding
            const embedding = await this.provider.generateEmbedding(text);

            // Cache the result
            if (this.config.cache) {
                const cacheKey = this.getCacheKey(text);
                this.cache.set(cacheKey, embedding);
            }

            const duration = Date.now() - startTime;
            this.emit('embedding:generated', {
                model: this.provider.getModel(),
                duration,
                dimension: embedding.length
            });

            return {
                embedding,
                model: this.provider.getModel(),
                cached: false
            };

        } catch (error) {
            this.logger.error('Failed to generate embedding:', error);
            this.emit('embedding:error', error);
            throw error;
        }
    }

    async generateEmbeddings(texts: string[]): Promise<EmbeddingResult[]> {
        const startTime = Date.now();
        const results: EmbeddingResult[] = [];

        try {
            // Separate cached and uncached texts
            const uncachedTexts: string[] = [];
            const textIndices: Map<string, number> = new Map();

            for (let i = 0; i < texts.length; i++) {
                const text = texts[i];
                if (this.config.cache) {
                    const cacheKey = this.getCacheKey(text);
                    const cached = this.cache.get(cacheKey);
                    if (cached) {
                        results[i] = {
                            embedding: cached,
                            model: this.provider.getModel(),
                            cached: true
                        };
                    } else {
                        uncachedTexts.push(text);
                        textIndices.set(text, i);
                    }
                } else {
                    uncachedTexts.push(text);
                    textIndices.set(text, i);
                }
            }

            // Generate embeddings for uncached texts
            if (uncachedTexts.length > 0) {
                const embeddings = await this.provider.generateEmbeddings(uncachedTexts);

                for (let i = 0; i < uncachedTexts.length; i++) {
                    const text = uncachedTexts[i];
                    const embedding = embeddings[i];
                    const originalIndex = textIndices.get(text)!;

                    // Cache the result
                    if (this.config.cache) {
                        const cacheKey = this.getCacheKey(text);
                        this.cache.set(cacheKey, embedding);
                    }

                    results[originalIndex] = {
                        embedding,
                        model: this.provider.getModel(),
                        cached: false
                    };
                }
            }

            const duration = Date.now() - startTime;
            this.emit('embeddings:generated', {
                count: texts.length,
                cached: texts.length - uncachedTexts.length,
                duration
            });

            return results;

        } catch (error) {
            this.logger.error('Failed to generate embeddings:', error);
            this.emit('embeddings:error', error);
            throw error;
        }
    }

    private getCacheKey(text: string): string {
        return `${this.provider.getModel()}:${text}`;
    }

    clearCache(): void {
        this.cache.clear();
        this.emit('cache:cleared');
    }

    getCacheSize(): number {
        return this.cache.size;
    }

    getDimension(): number {
        return this.provider.getDimension();
    }

    getModel(): string {
        return this.provider.getModel();
    }
}

// OpenAI Provider
class OpenAIEmbeddingProvider implements EmbeddingProvider {
    name = 'openai';
    private apiKey: string;
    private model: string;
    private dimension: number;
    private baseUrl: string;

    constructor(config: EmbeddingConfig) {
        this.apiKey = config.apiKey || process.env.OPENAI_API_KEY || '';
        this.model = config.model || 'text-embedding-ada-002';
        this.dimension = config.dimension || 1536;
        this.baseUrl = config.baseUrl || 'https://api.openai.com/v1';

        if (!this.apiKey) {
            throw new Error('OpenAI API key is required');
        }
    }

    async generateEmbedding(text: string): Promise<number[]> {
        const response = await fetch(`${this.baseUrl}/embeddings`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: this.model,
                input: text
            })
        });

        if (!response.ok) {
            throw new Error(`OpenAI API error: ${response.statusText}`);
        }

        const data = await response.json() as any;
        return data.data[0].embedding;
    }

    async generateEmbeddings(texts: string[]): Promise<number[][]> {
        const response = await fetch(`${this.baseUrl}/embeddings`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: this.model,
                input: texts
            })
        });

        if (!response.ok) {
            throw new Error(`OpenAI API error: ${response.statusText}`);
        }

        const data = await response.json() as any;
        return data.data.map((item: any) => item.embedding);
    }

    getDimension(): number {
        return this.dimension;
    }

    getModel(): string {
        return this.model;
    }
}

// Anthropic Provider (Claude)
class AnthropicEmbeddingProvider implements EmbeddingProvider {
    name = 'anthropic';
    private apiKey: string;
    private model: string;
    private dimension: number;

    constructor(config: EmbeddingConfig) {
        this.apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY || '';
        this.model = config.model || 'claude-embed';
        this.dimension = config.dimension || 1024;

        if (!this.apiKey) {
            throw new Error('Anthropic API key is required');
        }
    }

    async generateEmbedding(text: string): Promise<number[]> {
        // Note: Anthropic doesn't have a public embedding API yet
        // This is a placeholder for when they release one
        throw new Error('Anthropic embedding API not yet available');
    }

    async generateEmbeddings(texts: string[]): Promise<number[][]> {
        throw new Error('Anthropic embedding API not yet available');
    }

    getDimension(): number {
        return this.dimension;
    }

    getModel(): string {
        return this.model;
    }
}

// Cohere Provider
class CohereEmbeddingProvider implements EmbeddingProvider {
    name = 'cohere';
    private apiKey: string;
    private model: string;
    private dimension: number;

    constructor(config: EmbeddingConfig) {
        this.apiKey = config.apiKey || process.env.COHERE_API_KEY || '';
        this.model = config.model || 'embed-english-v3.0';
        this.dimension = config.dimension || 1024;

        if (!this.apiKey) {
            throw new Error('Cohere API key is required');
        }
    }

    async generateEmbedding(text: string): Promise<number[]> {
        const response = await fetch('https://api.cohere.ai/v1/embed', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: this.model,
                texts: [text],
                input_type: 'search_document'
            })
        });

        if (!response.ok) {
            throw new Error(`Cohere API error: ${response.statusText}`);
        }

        const data = await response.json() as any;
        return data.embeddings[0];
    }

    async generateEmbeddings(texts: string[]): Promise<number[][]> {
        const response = await fetch('https://api.cohere.ai/v1/embed', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: this.model,
                texts: texts,
                input_type: 'search_document'
            })
        });

        if (!response.ok) {
            throw new Error(`Cohere API error: ${response.statusText}`);
        }

        const data = await response.json() as any;
        return data.embeddings;
    }

    getDimension(): number {
        return this.dimension;
    }

    getModel(): string {
        return this.model;
    }
}

// HuggingFace Provider
class HuggingFaceEmbeddingProvider implements EmbeddingProvider {
    name = 'huggingface';
    private apiKey: string;
    private model: string;
    private dimension: number;
    private baseUrl: string;

    constructor(config: EmbeddingConfig) {
        this.apiKey = config.apiKey || process.env.HUGGINGFACE_API_KEY || '';
        this.model = config.model || 'sentence-transformers/all-MiniLM-L6-v2';
        this.dimension = config.dimension || 384;
        this.baseUrl = 'https://api-inference.huggingface.co/models';

        if (!this.apiKey) {
            throw new Error('HuggingFace API key is required');
        }
    }

    async generateEmbedding(text: string): Promise<number[]> {
        const response = await fetch(`${this.baseUrl}/${this.model}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                inputs: text
            })
        });

        if (!response.ok) {
            throw new Error(`HuggingFace API error: ${response.statusText}`);
        }

        const data = await response.json() as number[];
        return data;
    }

    async generateEmbeddings(texts: string[]): Promise<number[][]> {
        const response = await fetch(`${this.baseUrl}/${this.model}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                inputs: texts
            })
        });

        if (!response.ok) {
            throw new Error(`HuggingFace API error: ${response.statusText}`);
        }

        const data = await response.json() as any;
        return data;
    }

    getDimension(): number {
        return this.dimension;
    }

    getModel(): string {
        return this.model;
    }
}

// Ollama Provider (Local)
class OllamaEmbeddingProvider implements EmbeddingProvider {
    name = 'ollama';
    private model: string;
    private dimension: number;
    private baseUrl: string;

    constructor(config: EmbeddingConfig) {
        this.model = config.model || 'nomic-embed-text';
        this.dimension = config.dimension || 768;
        this.baseUrl = config.baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    }

    async generateEmbedding(text: string): Promise<number[]> {
        const response = await fetch(`${this.baseUrl}/api/embeddings`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: this.model,
                prompt: text
            })
        });

        if (!response.ok) {
            throw new Error(`Ollama API error: ${response.statusText}`);
        }

        const data = await response.json() as any;
        return data.embedding;
    }

    async generateEmbeddings(texts: string[]): Promise<number[][]> {
        // Ollama doesn't support batch embeddings, so we need to do them one by one
        const embeddings: number[][] = [];
        for (const text of texts) {
            const embedding = await this.generateEmbedding(text);
            embeddings.push(embedding);
        }
        return embeddings;
    }

    getDimension(): number {
        return this.dimension;
    }

    getModel(): string {
        return this.model;
    }
}

// Gemini Provider
class GeminiEmbeddingProvider implements EmbeddingProvider {
    name = 'gemini';
    private apiKey: string;
    private model: string;
    private dimension: number;

    constructor(config: EmbeddingConfig) {
        this.apiKey = config.apiKey || process.env.GEMINI_API_KEY || '';
        this.model = config.model || 'models/embedding-001';
        this.dimension = config.dimension || 768;

        if (!this.apiKey) {
            throw new Error('Gemini API key is required');
        }
    }

    async generateEmbedding(text: string): Promise<number[]> {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/${this.model}:embedContent?key=${this.apiKey}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: this.model,
                    content: {
                        parts: [{
                            text: text
                        }]
                    }
                })
            }
        );

        if (!response.ok) {
            throw new Error(`Gemini API error: ${response.statusText}`);
        }

        const data = await response.json() as any;
        return data.embedding.values;
    }

    async generateEmbeddings(texts: string[]): Promise<number[][]> {
        // Gemini doesn't support batch embeddings directly
        const embeddings: number[][] = [];
        for (const text of texts) {
            const embedding = await this.generateEmbedding(text);
            embeddings.push(embedding);
        }
        return embeddings;
    }

    getDimension(): number {
        return this.dimension;
    }

    getModel(): string {
        return this.model;
    }
}

export default EmbeddingService;