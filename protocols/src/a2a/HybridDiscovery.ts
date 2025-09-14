import { Logger } from '../../../logger';
// protocols/src/a2a/HybridDiscovery.ts
import { EventEmitter } from 'eventemitter3';
import axios from 'axios';
import bonjour from 'bonjour';
import { AgentProfile, AgentCard, AgentStatus } from './types';

export interface HybridDiscoveryConfig {
    registryUrl?: string;
    enableP2P?: boolean;
    mdnsInterface?: string;
    agentCard: AgentCard;
    port: number;
}

export class HybridDiscovery extends EventEmitter {
    private logger: Logger;
    public config: HybridDiscoveryConfig;
    private mdns?: any;
    private browser?: any;
    private discoveryMode: 'central' | 'p2p' | 'hybrid' = 'hybrid';
    private discoveredAgents = new Map<string, AgentProfile>();
    private registryClient = axios.create();

    constructor(config: HybridDiscoveryConfig) {
        super();
        this.config = config;
        this.logger = Logger.getLogger('HybridDiscovery').child({
            registryUrl: config.registryUrl,
            enableP2P: config.enableP2P,
            agentName: config.agentCard.name
        });
    }

    async initialize(): Promise<void> {
        const promises: Promise<void>[] = [];

        // Try central registry
        if (this.config.registryUrl) {
            promises.push(this.connectToCentralRegistry());
        }

        // Try P2P if enabled
        if (this.config.enableP2P !== false) {
            promises.push(this.initializeP2P());
        }

        const results = await Promise.allSettled(promises);

        // Determine discovery mode based on what succeeded
        const centralSuccess = this.config.registryUrl && results[0]?.status === 'fulfilled';
        const p2pSuccess = this.config.enableP2P && results[results.length - 1]?.status === 'fulfilled';

        if (centralSuccess && p2pSuccess) {
            this.discoveryMode = 'hybrid';
            this.logger.info('✅ Hybrid discovery initialized (Central + P2P)');
        } else if (centralSuccess) {
            this.discoveryMode = 'central';
            this.logger.info('✅ Central registry discovery initialized');
        } else if (p2pSuccess) {
            this.discoveryMode = 'p2p';
            this.logger.info('✅ P2P discovery initialized');
        } else {
            throw new Error('Failed to initialize any discovery mechanism');
        }
    }

    private async connectToCentralRegistry(): Promise<void> {
        if (!this.config.registryUrl) {
            throw new Error('Registry URL not configured');
        }

        try {
            // Test connection
            const response = await this.registryClient.get(
                `${this.config.registryUrl}/health`,
                { timeout: 5000 }
            );

            if (response.status === 200) {
                this.logger.info(`✅ Connected to central registry: ${this.config.registryUrl}`);
                this.emit('registry:connected', this.config.registryUrl);
            }
        } catch (error) {
            this.logger.error('Failed to connect to central registry:', error);
            throw error;
        }
    }

    private async initializeP2P(): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                this.mdns = bonjour();

                // Publish our agent
                const service = this.mdns.publish({
                    name: this.config.agentCard.name,
                    type: 'a2a-agent',
                    port: this.config.port,
                    txt: {
                        id: this.config.agentCard.name,
                        capabilities: JSON.stringify(
                            this.config.agentCard.capabilities?.map(c => c.name) || []
                        ),
                        endpoint: this.config.agentCard.url,
                        version: this.config.agentCard.version || '1.0.0'
                    }
                });
                
                // Handle service name conflicts
                service.on('error', (err: any) => {
                    if (err.message && err.message.includes('Service name is already in use')) {
                        this.logger.warn(`mDNS service name conflict for ${this.config.agentCard.name}, continuing without P2P`);
                        // Don't reject, just continue without this service
                    } else {
                        this.logger.error('mDNS service error:', err);
                    }
                });

                // Browse for other agents
                this.browser = this.mdns.find({ type: 'a2a-agent' });

                this.browser.on('up', (service: any) => {
                    const profile = this.parseServiceToProfile(service);
                    if (profile && profile.agentId !== this.config.agentCard.name) {
                        this.discoveredAgents.set(profile.agentId, profile);
                        this.emit('agent:discovered', profile);
                        this.logger.info(`🔍 Discovered P2P agent: ${profile.agentId}`);
                    }
                });

                this.browser.on('down', (service: any) => {
                    const agentId = service.txt?.id;
                    if (agentId) {
                        this.discoveredAgents.delete(agentId);
                        this.emit('agent:lost', agentId);
                        this.logger.info(`👋 Lost P2P agent: ${agentId}`);
                    }
                });

                this.logger.info('✅ P2P discovery initialized');
                resolve();

            } catch (error) {
                reject(error);
            }
        });
    }

    private parseServiceToProfile(service: any): AgentProfile | null {
        try {
            const txt = service.txt || {};
            const capabilities = txt.capabilities ?
                JSON.parse(txt.capabilities) : [];

            return {
                agentId: txt.id || service.name,
                agentType: 'discovered',
                status: AgentStatus.ONLINE,
                capabilities: capabilities.map((name: string) => ({
                    id: name,
                    name,
                    description: 'Discovered capability',
                    category: 'COMMUNICATION',
                    inputs: [],
                    outputs: [],
                    cost: 50,
                    reliability: 0.9,
                    version: '1.0.0'
                })),
                systemFeatures: {},
                metadata: {
                    version: txt.version || '1.0.0',
                    location: txt.endpoint || `http://${service.host}:${service.port}`,
                    load: 0,
                    uptime: 0,
                    capabilities_count: capabilities.length,
                    registeredAt: new Date(),
                    lastUpdated: new Date()
                },
                lastSeen: new Date(),
                networkAddress: `${service.host}:${service.port}`
            };
        } catch (error) {
            this.logger.error('Failed to parse service:', error);
            return null;
        }
    }

    async discoverAgents(): Promise<AgentProfile[]> {
        switch (this.discoveryMode) {
            case 'central':
                return this.discoverFromRegistry();
            case 'p2p':
                return this.discoverFromP2P();
            case 'hybrid':
                return this.discoverHybrid();
            default:
                return [];
        }
    }

    private async discoverFromRegistry(): Promise<AgentProfile[]> {
        if (!this.config.registryUrl) {
            return [];
        }

        try {
            const response = await this.registryClient.get(
                `${this.config.registryUrl}/api/registry/discover`
            );
            return response.data.agents || [];
        } catch (error) {
            this.logger.error('Registry discovery failed:', error);
            return [];
        }
    }

    private discoverFromP2P(): AgentProfile[] {
        return Array.from(this.discoveredAgents.values());
    }

    /**
     * Get all discovered agents
     */
    getDiscoveredAgents(): Map<string, AgentProfile> {
        return this.discoveredAgents;
    }

    private async discoverHybrid(): Promise<AgentProfile[]> {
        const [central, p2p] = await Promise.all([
            this.discoverFromRegistry(),
            Promise.resolve(this.discoverFromP2P())
        ]);

        return this.mergeAndDeduplicate(central, p2p);
    }

    private mergeAndDeduplicate(
        central: AgentProfile[],
        p2p: AgentProfile[]
    ): AgentProfile[] {
        const merged = new Map<string, AgentProfile>();

        // Add central agents (priorité)
        for (const agent of central) {
            merged.set(agent.agentId, agent);
        }

        // Add P2P agents if not already present
        for (const agent of p2p) {
            if (!merged.has(agent.agentId)) {
                merged.set(agent.agentId, agent);
            }
        }

        return Array.from(merged.values());
    }

    async registerWithCentral(profile: AgentProfile): Promise<void> {
        if (!this.config.registryUrl) {
            throw new Error('No central registry configured');
        }

        await this.registryClient.post(
            `${this.config.registryUrl}/api/registry/register`,
            profile
        );
    }

    async sendHeartbeat(agentId: string): Promise<void> {
        if (this.discoveryMode === 'central' || this.discoveryMode === 'hybrid') {
            // Send to central registry
            if (this.config.registryUrl) {
                try {
                    await this.registryClient.put(
                        `${this.config.registryUrl}/api/registry/agents/${agentId}/status`,
                        { status: AgentStatus.ONLINE }
                    );
                } catch (error) {
                    this.logger.error('Heartbeat failed:', error);
                }
            }
        }

        // P2P heartbeat is automatic via mDNS
    }

    async shutdown(): Promise<void> {
        if (this.browser) {
            this.browser.stop();
        }
        if (this.mdns) {
            this.mdns.unpublishAll();
            this.mdns.destroy();
        }

        this.discoveredAgents.clear();
        this.emit('shutdown');
        this.logger.info('🔌 Discovery service shut down');
    }
}