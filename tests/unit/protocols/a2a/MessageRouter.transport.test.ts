// tests/unit/protocols/a2a/MessageRouter.transport.test.ts

import {

    A2AConfig,
    A2AMessage,
    A2AMessageType, AgentProfile,
    AgentStatus,
    CapabilityCategory,

} from '../../../../protocols/src/a2a/types';

import {A2AAgentRegistry} from '../../../../protocols/src/a2a/A2AAgentRegistry';
import {MessageRouter} from '../../../../protocols/src/a2a/MessageRouter';

import {A2AClient} from '../../../../protocols/src/a2a/A2AClient';
import {jest} from "@jest/globals";

// Mock A2AClient
jest.mock('../../../../protocols/src/a2a/A2AClient');

describe('MessageRouter with Real Transport', () => {
    let router: MessageRouter;
    let registry: A2AAgentRegistry;
    let config: A2AConfig;
    let mockClient: jest.Mocked<A2AClient>;

    beforeEach(() => {
        // Setup mock A2AClient
        mockClient = {
            sendMessage: jest.fn(() => Promise.resolve({
                jsonrpc: '2.0',
                id: '1',
                result: {
                    kind: 'message',
                    messageId: 'mock-response-1',
                    role: 'agent',
                    parts: [{ kind: 'text', text: 'Mock response' }]
                }
            })),
            close: jest.fn(),
            on: jest.fn(),
            emit: jest.fn(),
            getAgentCard: jest.fn(() => Promise.resolve({
                protocolVersion: '1.0',
                name: 'Mock Agent',
                url: 'http://localhost:8080/jsonrpc',
                capabilities: []
            }))
        } as any;

        // Mock constructor
        (A2AClient as jest.MockedClass<typeof A2AClient>).mockImplementation(() => mockClient);

        config = {
            networkName: 'test-network',
            broadcastInterval: 30000,
            messageTimeout: 5000,
            maxRetries: 3,
            enableHealthMonitoring: true,
            enableWorkflowEngine: false,
            logLevel: 'info',
            performance: {
                maxConcurrentTasks: 10,
                queueSize: 100,
                routingAlgorithm: 'best-match'
            }
        };

        registry = new A2AAgentRegistry(config);
        router = new MessageRouter(registry, config);
    });

    afterEach(() => {
        router.shutdown();
    });

    describe('Transport Integration', () => {
        it('should create A2AClient for agents with endpoints', async () => {
            const agent = createTestAgent('transport-agent');
            await registry.registerAgent(agent);

            // Spy on getOrCreateClient
            const getClientSpy = jest.spyOn(router as any, 'getOrCreateClient');

            const message: A2AMessage = {
                id: 'transport-001',
                role: 'user',
                from: 'client',
                to: 'transport-agent',
                type: A2AMessageType.TASK_REQUEST,
                payload: { test: 'data' },
                timestamp: new Date(),
                priority: 'normal'
            };

            await router.routeMessage(message);
            await new Promise(resolve => setTimeout(resolve, 20));

            expect(getClientSpy).toHaveBeenCalledWith('transport-agent');
        });

        it('should reuse clients from pool', async () => {
            const agent = createTestAgent('pool-agent');
            await registry.registerAgent(agent);
            await router.updateEndpointsFromRegistry();

            const message1: A2AMessage = {
                id: 'pool-001',
                role: 'user',
                from: 'client',
                to: 'pool-agent',
                type: A2AMessageType.TASK_REQUEST,
                payload: { test: 1 },
                timestamp: new Date(),
                priority: 'normal'
            };

            const message2: A2AMessage = {
                ...message1,
                id: 'pool-002',
                payload: { test: 2 }
            };

            await router.routeMessage(message1);
            await router.routeMessage(message2);

            // Check client pool size
            const endpoints = router.getEndpoints();
            expect(endpoints.size).toBe(1);

            // Same client should be used
            expect(A2AClient).toHaveBeenCalledTimes(1);
        });

        it('should handle endpoint registration', () => {
            router.registerAgentEndpoint('new-agent', 'http://localhost:9000');

            const endpoints = router.getEndpoints();
            expect(endpoints.get('new-agent')).toBe('http://localhost:9000');
        });

        it('should update endpoints from registry', async () => {
            const agent1 = createTestAgent('update-1');
            const agent2 = createTestAgent('update-2');

            await registry.registerAgent(agent1);
            await registry.registerAgent(agent2);

            await router.updateEndpointsFromRegistry();

            const endpoints = router.getEndpoints();
            expect(endpoints.size).toBeGreaterThanOrEqual(2);
        });

        it('should handle missing endpoints gracefully', async () => {
            const agent = createTestAgent('no-endpoint');
            (agent.metadata as any).location = undefined; // Remove endpoint

            await registry.registerAgent(agent);

            const message: A2AMessage = {
                id: 'no-endpoint-001',
                role: 'user',
                from: 'client',
                to: 'no-endpoint',
                type: A2AMessageType.TASK_REQUEST,
                payload: {},
                timestamp: new Date(),
                priority: 'normal'
            };

            const response = await router.routeMessage(message);

            expect(response.success).toBe(false);
            expect(response.error).toContain('No endpoint configured');
        });

        it('should convert message formats correctly', async () => {
            const agent = createTestAgent('convert-agent');
            await registry.registerAgent(agent);

            // Complex payload
            const complexPayload = {
                nested: {
                    data: [1, 2, 3],
                    metadata: { key: 'value' }
                }
            };

            const message: A2AMessage = {
                id: 'convert-001',
                role: 'agent',
                from: 'system',
                to: 'convert-agent',
                type: A2AMessageType.TASK_REQUEST,
                payload: complexPayload,
                timestamp: new Date(),
                priority: 'high',
                correlationId: 'corr-123'
            };

            await router.routeMessage(message);
            await new Promise(resolve => setTimeout(resolve, 20));

            // Verify sendMessage was called with correct format
            expect(mockClient.sendMessage).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: expect.objectContaining({
                        role: 'agent',
                        messageId: 'convert-001',
                        contextId: 'corr-123',
                        parts: expect.arrayContaining([
                            expect.objectContaining({
                                kind: 'data',
                                data: complexPayload
                            })
                        ])
                    })
                })
            );
        });

        it('should handle broadcast via transport', async () => {
            const agent1 = createTestAgent('broadcast-1');
            const agent2 = createTestAgent('broadcast-2');

            await registry.registerAgent(agent1);
            await registry.registerAgent(agent2);

            const broadcastMessage: A2AMessage = {
                id: 'broadcast-transport',
                role: 'agent',
                from: 'orchestrator',
                to: 'broadcast',
                type: A2AMessageType.NETWORK_BROADCAST,
                payload: { announcement: 'Test' },
                timestamp: new Date(),
                priority: 'high'
            };

            const response = await router.routeMessage(broadcastMessage);

            expect(response.success).toBeDefined();
            expect(response.data).toHaveProperty('totalAgents');
            expect(response.data).toHaveProperty('successful');
            expect(response.data).toHaveProperty('failed');
        });

        it('should cleanup clients on shutdown', async () => {
            const agent = createTestAgent('cleanup-agent');
            await registry.registerAgent(agent);

            // Create client
            const message: A2AMessage = {
                id: 'cleanup-001',
                role: 'user',
                from: 'client',
                to: 'cleanup-agent',
                type: A2AMessageType.TASK_REQUEST,
                payload: {},
                timestamp: new Date(),
                priority: 'normal'
            };

            await router.routeMessage(message);

            router.shutdown();

            expect(mockClient.close).toHaveBeenCalled();
        });
    });


    // tests/integration/a2a/MessageRouter.integration.test.ts

    describe('MessageRouter Integration Tests', () => {
        it.skip('should route message through real network', async () => {
            // TODO: This test requires full integration setup with real A2AAgentServer
            // Implementation pending...
        });
    });



    // The following tests are already inside the main describe block
    // No need for another nested describe
    describe('Additional Transport Integration', () => {
            it('should create A2AClient for agents with endpoints', async () => {
                const agent = createTestAgent('transport-agent');
                await registry.registerAgent(agent);

                // Spy on getOrCreateClient
                const getClientSpy = jest.spyOn(router as any, 'getOrCreateClient');

                const message: A2AMessage = {
                    id: 'transport-001',
                    role: 'user',
                    from: 'client',
                    to: 'transport-agent',
                    type: A2AMessageType.TASK_REQUEST,
                    payload: { test: 'data' },
                    timestamp: new Date(),
                    priority: 'normal'
                };

                await router.routeMessage(message);
                await new Promise(resolve => setTimeout(resolve, 20));

                expect(getClientSpy).toHaveBeenCalledWith('transport-agent');
            });

            it('should reuse clients from pool', async () => {
                const agent = createTestAgent('pool-agent');
                await registry.registerAgent(agent);

                const message1: A2AMessage = {
                    id: 'pool-001',
                    role: 'user',
                    from: 'client',
                    to: 'pool-agent',
                    type: A2AMessageType.TASK_REQUEST,
                    payload: { test: 1 },
                    timestamp: new Date(),
                    priority: 'normal'
                };

                const message2: A2AMessage = {
                    ...message1,
                    id: 'pool-002',
                    payload: { test: 2 }
                };

                await router.routeMessage(message1);
                await router.routeMessage(message2);

                // Check client pool size
                const endpoints = router.getEndpoints();
                expect(endpoints.size).toBe(1);

                // Same client should be used
                expect(A2AClient).toHaveBeenCalledTimes(1);
            });

            it('should handle endpoint registration', () => {
                router.registerAgentEndpoint('new-agent', 'http://localhost:9000');

                const endpoints = router.getEndpoints();
                expect(endpoints.get('new-agent')).toBe('http://localhost:9000');
            });

            it('should update endpoints from registry', async () => {
                const agent1 = createTestAgent('update-1');
                const agent2 = createTestAgent('update-2');

                await registry.registerAgent(agent1);
                await registry.registerAgent(agent2);

                await router.updateEndpointsFromRegistry();

                const endpoints = router.getEndpoints();
                expect(endpoints.size).toBeGreaterThanOrEqual(2);
            });

            it('should handle missing endpoints gracefully', async () => {
                const agent = createTestAgent('no-endpoint');
                (agent.metadata as any).location = undefined; // Remove endpoint

                await registry.registerAgent(agent);

                const message: A2AMessage = {
                    id: 'no-endpoint-001',
                    role: 'user',
                    from: 'client',
                    to: 'no-endpoint',
                    type: A2AMessageType.TASK_REQUEST,
                    payload: {},
                    timestamp: new Date(),
                    priority: 'normal'
                };

                const response = await router.routeMessage(message);

                expect(response.success).toBe(false);
                expect(response.error).toContain('No endpoint configured');
            });

            it('should convert message formats correctly', async () => {
                const agent = createTestAgent('convert-agent');
                await registry.registerAgent(agent);

                // Complex payload
                const complexPayload = {
                    nested: {
                        data: [1, 2, 3],
                        metadata: { key: 'value' }
                    }
                };

                const message: A2AMessage = {
                    id: 'convert-001',
                    role: 'agent',
                    from: 'system',
                    to: 'convert-agent',
                    type: A2AMessageType.TASK_REQUEST,
                    payload: complexPayload,
                    timestamp: new Date(),
                    priority: 'high',
                    correlationId: 'corr-123'
                };

                await router.routeMessage(message);
                await new Promise(resolve => setTimeout(resolve, 20));

                // Verify sendMessage was called with correct format
                expect(mockClient.sendMessage).toHaveBeenCalledWith(
                    expect.objectContaining({
                        message: expect.objectContaining({
                            role: 'agent',
                            messageId: 'convert-001',
                            contextId: 'corr-123',
                            parts: expect.arrayContaining([
                                expect.objectContaining({
                                    kind: 'data',
                                    data: complexPayload
                                })
                            ])
                        })
                    })
                );
            });

            it('should handle broadcast via transport', async () => {
                const agent1 = createTestAgent('broadcast-1');
                const agent2 = createTestAgent('broadcast-2');

                await registry.registerAgent(agent1);
                await registry.registerAgent(agent2);

                const broadcastMessage: A2AMessage = {
                    id: 'broadcast-transport',
                    role: 'agent',
                    from: 'orchestrator',
                    to: 'broadcast',
                    type: A2AMessageType.NETWORK_BROADCAST,
                    payload: { announcement: 'Test' },
                    timestamp: new Date(),
                    priority: 'high'
                };

                const response = await router.routeMessage(broadcastMessage);

                expect(response.success).toBeDefined();
                expect(response.data).toHaveProperty('totalAgents');
                expect(response.data).toHaveProperty('successful');
                expect(response.data).toHaveProperty('failed');
            });

            it('should cleanup clients on shutdown', async () => {
                const agent = createTestAgent('cleanup-agent');
                await registry.registerAgent(agent);

                // Create client
                const message: A2AMessage = {
                    id: 'cleanup-001',
                    role: 'user',
                    from: 'client',
                    to: 'cleanup-agent',
                    type: A2AMessageType.TASK_REQUEST,
                    payload: {},
                    timestamp: new Date(),
                    priority: 'normal'
                };

                await router.routeMessage(message);

                router.shutdown();

                expect(mockClient.close).toHaveBeenCalled();
            });
        });

        describe('Circuit Breaker with Transport', () => {
            it('should record transport failures in circuit breaker', async () => {
                const agent = createTestAgent('circuit-transport');
                await registry.registerAgent(agent);

                // Make client fail
                mockClient.sendMessage.mockRejectedValue(new Error('Network error'));

                router.enableCircuitBreaker('circuit-transport', {
                    failureThreshold: 2
                });

                const message: A2AMessage = {
                    id: 'circuit-fail',
                    role: 'user',
                    from: 'client',
                    to: 'circuit-transport',
                    type: A2AMessageType.TASK_REQUEST,
                    payload: {},
                    timestamp: new Date(),
                    priority: 'normal'
                };

                // Send messages that will fail
                await router.routeMessage(message);
                await new Promise(resolve => setTimeout(resolve, 50));

                await router.routeMessage({ ...message, id: 'circuit-fail-2' });
                await new Promise(resolve => setTimeout(resolve, 50));

                // Circuit should be open
                const status = router.getCircuitStatus('circuit-transport');
                expect(status?.failures).toBeGreaterThanOrEqual(2);
            });

            it('should record transport successes', async () => {
                const agent = createTestAgent('circuit-success');
                await registry.registerAgent(agent);

                router.enableCircuitBreaker('circuit-success');

                const message: A2AMessage = {
                    id: 'success-001',
                    role: 'user',
                    from: 'client',
                    to: 'circuit-success',
                    type: A2AMessageType.TASK_REQUEST,
                    payload: {},
                    timestamp: new Date(),
                    priority: 'normal'
                };

                await router.routeMessage(message);
                await new Promise(resolve => setTimeout(resolve, 20));

                const status = router.getCircuitStatus('circuit-success');
                expect(status?.successes).toBeGreaterThan(0);
            });
        });
    
        describe('Circuit Breaker with Transport', () => {
        it('should record transport failures in circuit breaker', async () => {
            const agent = createTestAgent('circuit-transport');
            await registry.registerAgent(agent);

            // Make client fail
            mockClient.sendMessage.mockRejectedValue(new Error('Network error'));

            router.enableCircuitBreaker('circuit-transport', {
                failureThreshold: 2
            });

            const message: A2AMessage = {
                id: 'circuit-fail',
                role: 'user',
                from: 'client',
                to: 'circuit-transport',
                type: A2AMessageType.TASK_REQUEST,
                payload: {},
                timestamp: new Date(),
                priority: 'normal'
            };

            // Send messages that will fail
            await router.routeMessage(message);
            await new Promise(resolve => setTimeout(resolve, 50));

            await router.routeMessage({ ...message, id: 'circuit-fail-2' });
            await new Promise(resolve => setTimeout(resolve, 50));

            // Circuit should be open
            const status = router.getCircuitStatus('circuit-transport');
            expect(status?.failures).toBeGreaterThanOrEqual(2);
        });

        it('should record transport successes', async () => {
            const agent = createTestAgent('circuit-success');
            await registry.registerAgent(agent);

            router.enableCircuitBreaker('circuit-success');

            const message: A2AMessage = {
                id: 'success-001',
                role: 'user',
                from: 'client',
                to: 'circuit-success',
                type: A2AMessageType.TASK_REQUEST,
                payload: {},
                timestamp: new Date(),
                priority: 'normal'
            };

            await router.routeMessage(message);
            await new Promise(resolve => setTimeout(resolve, 20));

            const status = router.getCircuitStatus('circuit-success');
            expect(status?.successes).toBeGreaterThan(0);
        });
    });
});

// Helper function to create a test agent
// Modifier createTestAgent pour inclure location
function createTestAgent(id: string, capabilityName = 'test-capability'): AgentProfile {
    return {
        agentId: id,
        agentType: 'TestAgent',
        status: AgentStatus.ONLINE,
        capabilities: [{
            id: capabilityName,
            name: capabilityName,
            description: 'Test capability',
            category: CapabilityCategory.ANALYSIS,
            inputs: [],
            outputs: [],
            cost: 50,
            reliability: 0.9,
            version: '1.0.0'
        }],
        systemFeatures: {
            streaming: false,
            pushNotifications: false
        },
        metadata: {
            version: '1.0.0',
            location: `http://localhost:${8080 + Math.floor(Math.random() * 100)}`, // ✅ ENDPOINT RÉEL
            load: 50,
            uptime: Date.now(),
            capabilities_count: 1,
            registeredAt: new Date(),
            lastUpdated: new Date(),
            performance_metrics: {
                avg_response_time: 100,
                success_rate: 0.95,
                total_requests: 100
            }
        },
        lastSeen: new Date()
    };
}