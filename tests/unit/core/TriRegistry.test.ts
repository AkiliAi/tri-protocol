import { TriRegistry } from '../../../core/src/TriRegistry';
import { AgentProfile, AgentStatus } from '../../../protocols/src/a2a/types';

describe('TriRegistry', () => {
    let registry: TriRegistry;

    beforeEach(() => {
        registry = new TriRegistry();
    });

    afterEach(() => {
        registry.removeAllListeners();
    });

    describe('Constructor', () => {
        it('should create a new registry instance', () => {
            expect(registry).toBeInstanceOf(TriRegistry);
        });

        it('should initialize with empty entries', () => {
            expect(registry.getAll()).toEqual([]);
        });

        it('should initialize protocol indexes', () => {
            expect(registry.findByProtocol('a2a')).toEqual([]);
            expect(registry.findByProtocol('langgraph')).toEqual([]);
            expect(registry.findByProtocol('mcp')).toEqual([]);
        });
    });

    describe('register()', () => {
        const mockProfile: AgentProfile = {
            agentId: 'test-agent-1',
            agentType: 'test',
            status: AgentStatus.ONLINE,
            capabilities: [
                { name: 'reasoning', description: 'Can reason' },
                { name: 'analysis', description: 'Can analyze' }
            ] as any,
            systemFeatures: {
                streaming: false,
                pushNotifications: false
            },
            metadata: {
                version: '1.0.0',
                location: 'test://agent',
                load: 0,
                uptime: Date.now(),
                capabilities_count: 2,
                registeredAt: new Date(),
                lastUpdated: new Date()
            } as any,
            lastSeen: new Date()
        };

        it('should register an agent successfully', () => {
            registry.register('a2a', mockProfile);

            const entry = registry.get('test-agent-1');
            expect(entry).toBeDefined();
            expect(entry?.profile.agentId).toBe('test-agent-1');
            expect(entry?.protocol).toBe('a2a');
        });

        it('should update protocol index when registering', () => {
            registry.register('a2a', mockProfile);

            const a2aAgents = registry.findByProtocol('a2a');
            expect(a2aAgents).toHaveLength(1);
            expect(a2aAgents[0].profile.agentId).toBe('test-agent-1');
        });

        it('should update capability index when registering', () => {
            registry.register('a2a', mockProfile);

            const reasoningAgents = registry.findByCapability('reasoning');
            expect(reasoningAgents).toHaveLength(1);
            expect(reasoningAgents[0].profile.agentId).toBe('test-agent-1');

            const analysisAgents = registry.findByCapability('analysis');
            expect(analysisAgents).toHaveLength(1);
        });

        it('should emit agent:registered event', (done) => {
            registry.on('agent:registered', (entry) => {
                expect(entry.profile.agentId).toBe('test-agent-1');
                done();
            });

            registry.register('a2a', mockProfile);
        });

        it('should set registeredAt and lastUpdated timestamps', () => {
            const beforeTime = new Date();
            registry.register('a2a', mockProfile);
            const afterTime = new Date();

            const entry = registry.get('test-agent-1');
            expect(entry?.registeredAt.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
            expect(entry?.registeredAt.getTime()).toBeLessThanOrEqual(afterTime.getTime());
            expect(entry?.lastUpdated).toEqual(entry?.registeredAt);
        });
    });

    describe('unregister()', () => {
        const mockProfile: AgentProfile = {
            agentId: 'test-agent-2',
            agentType: 'test',
            status: AgentStatus.ONLINE,
            capabilities: [
                { name: 'monitoring', description: 'Can monitor' }
            ] as any,
            systemFeatures: {
                streaming: false,
                pushNotifications: false
            },
            metadata: {} as any,
            lastSeen: new Date()
        };

        beforeEach(() => {
            registry.register('langgraph', mockProfile);
        });

        it('should unregister an agent successfully', () => {
            registry.unregister('test-agent-2');

            const entry = registry.get('test-agent-2');
            expect(entry).toBeUndefined();
        });

        it('should update protocol index when unregistering', () => {
            registry.unregister('test-agent-2');

            const langGraphAgents = registry.findByProtocol('langgraph');
            expect(langGraphAgents).toHaveLength(0);
        });

        it('should update capability index when unregistering', () => {
            registry.unregister('test-agent-2');

            const monitoringAgents = registry.findByCapability('monitoring');
            expect(monitoringAgents).toHaveLength(0);
        });

        it('should emit agent:unregistered event', (done) => {
            registry.on('agent:unregistered', (agentId) => {
                expect(agentId).toBe('test-agent-2');
                done();
            });

            registry.unregister('test-agent-2');
        });

        it('should handle unregistering non-existent agent gracefully', () => {
            expect(() => registry.unregister('non-existent')).not.toThrow();
        });
    });

    describe('findByCapability()', () => {
        const agents: AgentProfile[] = [
            {
                agentId: 'agent-1',
                agentType: 'test',
                status: AgentStatus.ONLINE,
                capabilities: [
                    { name: 'reasoning', description: 'Can reason' },
                    { name: 'analysis', description: 'Can analyze' }
                ] as any,
                systemFeatures: { streaming: false, pushNotifications: false },
                metadata: {} as any,
                lastSeen: new Date()
            },
            {
                agentId: 'agent-2',
                agentType: 'test',
                status: AgentStatus.ONLINE,
                capabilities: [
                    { name: 'reasoning', description: 'Can reason' },
                    { name: 'monitoring', description: 'Can monitor' }
                ] as any,
                systemFeatures: { streaming: false, pushNotifications: false },
                metadata: {} as any,
                lastSeen: new Date()
            },
            {
                agentId: 'agent-3',
                agentType: 'test',
                status: AgentStatus.ONLINE,
                capabilities: [
                    { name: 'monitoring', description: 'Can monitor' }
                ] as any,
                systemFeatures: { streaming: false, pushNotifications: false },
                metadata: {} as any,
                lastSeen: new Date()
            }
        ];

        beforeEach(() => {
            registry.register('a2a', agents[0]);
            registry.register('a2a', agents[1]);
            registry.register('langgraph', agents[2]);
        });

        it('should find agents with specific capability', () => {
            const reasoningAgents = registry.findByCapability('reasoning');
            expect(reasoningAgents).toHaveLength(2);
            expect(reasoningAgents.map(e => e.profile.agentId)).toContain('agent-1');
            expect(reasoningAgents.map(e => e.profile.agentId)).toContain('agent-2');
        });

        it('should return empty array for non-existent capability', () => {
            const agents = registry.findByCapability('non-existent');
            expect(agents).toEqual([]);
        });

        it('should find agents across different protocols', () => {
            const monitoringAgents = registry.findByCapability('monitoring');
            expect(monitoringAgents).toHaveLength(2);
            expect(monitoringAgents.map(e => e.protocol)).toContain('a2a');
            expect(monitoringAgents.map(e => e.protocol)).toContain('langgraph');
        });
    });

    describe('findByProtocol()', () => {
        beforeEach(() => {
            const profile1: AgentProfile = {
                agentId: 'a2a-agent',
                agentType: 'test',
                status: AgentStatus.ONLINE,
                capabilities: [] as any,
                systemFeatures: { streaming: false, pushNotifications: false },
                metadata: {} as any,
                lastSeen: new Date()
            };

            const profile2: AgentProfile = {
                agentId: 'mcp-agent',
                agentType: 'test',
                status: AgentStatus.ONLINE,
                capabilities: [] as any,
                systemFeatures: { streaming: false, pushNotifications: false },
                metadata: {} as any,
                lastSeen: new Date()
            };

            registry.register('a2a', profile1);
            registry.register('mcp', profile2);
        });

        it('should find agents by protocol', () => {
            const a2aAgents = registry.findByProtocol('a2a');
            expect(a2aAgents).toHaveLength(1);
            expect(a2aAgents[0].profile.agentId).toBe('a2a-agent');

            const mcpAgents = registry.findByProtocol('mcp');
            expect(mcpAgents).toHaveLength(1);
            expect(mcpAgents[0].profile.agentId).toBe('mcp-agent');
        });

        it('should return empty array for protocol with no agents', () => {
            const langGraphAgents = registry.findByProtocol('langgraph');
            expect(langGraphAgents).toEqual([]);
        });
    });

    describe('get()', () => {
        const mockProfile: AgentProfile = {
            agentId: 'get-test-agent',
            agentType: 'test',
            status: AgentStatus.ONLINE,
            capabilities: [] as any,
            systemFeatures: { streaming: false, pushNotifications: false },
            metadata: {} as any,
            lastSeen: new Date()
        };

        it('should retrieve registered agent', () => {
            registry.register('a2a', mockProfile);

            const entry = registry.get('get-test-agent');
            expect(entry).toBeDefined();
            expect(entry?.profile.agentId).toBe('get-test-agent');
        });

        it('should return undefined for non-existent agent', () => {
            const entry = registry.get('non-existent');
            expect(entry).toBeUndefined();
        });
    });

    describe('getAll()', () => {
        it('should return empty array when no agents registered', () => {
            expect(registry.getAll()).toEqual([]);
        });

        it('should return all registered agents', () => {
            const profiles: AgentProfile[] = [
                {
                    agentId: 'agent-1',
                    agentType: 'test',
                    status: AgentStatus.ONLINE,
                    capabilities: [] as any,
                    systemFeatures: { streaming: false, pushNotifications: false },
                    metadata: {} as any,
                    lastSeen: new Date()
                },
                {
                    agentId: 'agent-2',
                    agentType: 'test',
                    status: AgentStatus.ONLINE,
                    capabilities: [] as any,
                    systemFeatures: { streaming: false, pushNotifications: false },
                    metadata: {} as any,
                    lastSeen: new Date()
                }
            ];

            registry.register('a2a', profiles[0]);
            registry.register('langgraph', profiles[1]);

            const all = registry.getAll();
            expect(all).toHaveLength(2);
            expect(all.map(e => e.profile.agentId)).toContain('agent-1');
            expect(all.map(e => e.profile.agentId)).toContain('agent-2');
        });
    });

    describe('getStats()', () => {
        it('should return stats for empty registry', () => {
            const stats = registry.getStats();
            expect(stats).toEqual({
                totalAgents: 0,
                byProtocol: {
                    a2a: 0,
                    langgraph: 0,
                    mcp: 0
                },
                totalCapabilities: 0
            });
        });

        it('should return correct stats after registrations', () => {
            const profiles: AgentProfile[] = [
                {
                    agentId: 'agent-1',
                    agentType: 'test',
                    status: AgentStatus.ONLINE,
                    capabilities: [
                        { name: 'cap1', description: 'Capability 1' },
                        { name: 'cap2', description: 'Capability 2' }
                    ] as any,
                    systemFeatures: { streaming: false, pushNotifications: false },
                    metadata: {} as any,
                    lastSeen: new Date()
                },
                {
                    agentId: 'agent-2',
                    agentType: 'test',
                    status: AgentStatus.ONLINE,
                    capabilities: [
                        { name: 'cap2', description: 'Capability 2' },
                        { name: 'cap3', description: 'Capability 3' }
                    ] as any,
                    systemFeatures: { streaming: false, pushNotifications: false },
                    metadata: {} as any,
                    lastSeen: new Date()
                }
            ];

            registry.register('a2a', profiles[0]);
            registry.register('mcp', profiles[1]);

            const stats = registry.getStats();
            expect(stats).toEqual({
                totalAgents: 2,
                byProtocol: {
                    a2a: 1,
                    langgraph: 0,
                    mcp: 1
                },
                totalCapabilities: 3 // cap1, cap2, cap3
            });
        });
    });
});