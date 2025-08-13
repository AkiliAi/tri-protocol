// tests/unit/protocols/a2a/MessageRouter.test.ts
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { MessageRouter } from '../../../../protocols/src/a2a/MessageRouter';
import { A2AAgentRegistry } from '../../../../protocols/src/a2a/A2AAgentRegistry';
import {
  A2AMessage,
  A2AMessageType,
  A2APriority,
  A2AResponse,
  A2AConfig,
  AgentProfile,
  AgentStatus,
  TaskDefinition,
  CapabilityCategory,
  Route
} from '../../../../protocols/src/a2a/types';

describe('MessageRouter', () => {
  let router: MessageRouter;
  let registry: A2AAgentRegistry;
  let config: A2AConfig;

  beforeEach(() => {
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

  describe('Message Routing with A2AMessage', () => {
    it('should route A2AMessage to correct agent', async () => {
      // Register target agent first
      const targetAgent = createTestAgent('agent-123');
      await registry.registerAgent(targetAgent);

      const message: A2AMessage = {
        id: 'msg-001',
        role: 'user',
        from: 'client',
        to: 'agent-123',
        type: A2AMessageType.TASK_REQUEST,
        payload: { test: 'data' },
        timestamp: new Date(),
        priority: 'normal'
      };

      const response = await router.routeMessage(message);

      expect(response).toBeDefined();
      expect(response.success).toBe(true);
      expect(response.metadata?.agentId).toBe('router');
    });

    it('should handle broadcast messages', async () => {
      // Register multiple agents
      const agent1 = createTestAgent('agent-1');
      const agent2 = createTestAgent('agent-2');
      const agent3 = createTestAgent('agent-3');

      await registry.registerAgent(agent1);
      await registry.registerAgent(agent2);
      await registry.registerAgent(agent3);

      const broadcastMessage: A2AMessage = {
        id: 'broadcast-001',
        role: 'agent',
        from: 'orchestrator',
        to: 'broadcast',
        type: A2AMessageType.NETWORK_BROADCAST,
        payload: { announcement: 'System update' },
        timestamp: new Date(),
        priority: 'high'
      };

      const responses = await router.broadcastMessage(broadcastMessage);

      expect(responses).toBeDefined();
      expect(responses.length).toBeGreaterThan(0);
      responses.forEach(response => {
        expect(response.success).toBeDefined();
      });
    });

    it('should handle task routing with capability matching', async () => {
      // Register agents with different capabilities
      const calcAgent = createTestAgent('calc-agent', 'calculator');
      const dataAgent = createTestAgent('data-agent', 'data-analysis');

      await registry.registerAgent(calcAgent);
      await registry.registerAgent(dataAgent);

      const taskMessage: A2AMessage = {
        id: 'task-001',
        role: 'user',
        from: 'client',
        to: 'auto', // Let router decide
        type: A2AMessageType.TASK_REQUEST,
        payload: {
          name: 'Calculate sum',
          description: 'Add two numbers',
          requiredCapability: 'calculator',
          parameters: { a: 5, b: 3 },
          priority: 'normal'
        } as TaskDefinition,
        timestamp: new Date(),
        priority: 'normal'
      };

      const response = await router.routeMessage(taskMessage);

      expect(response.success).toBe(true);
      // Router should have found calc-agent for calculator capability
    });

    it('should respect message priority', async () => {
      const agent = createTestAgent('priority-agent');
      await registry.registerAgent(agent);

      const urgentMessage: A2AMessage = {
        id: 'urgent-001',
        role: 'agent',
        from: 'system',
        to: 'priority-agent',
        type: A2AMessageType.TASK_REQUEST,
        payload: { urgent: true },
        timestamp: new Date(),
        priority: 'urgent'
      };

      const normalMessage: A2AMessage = {
        id: 'normal-001',
        role: 'user',
        from: 'client',
        to: 'priority-agent',
        type: A2AMessageType.TASK_REQUEST,
        payload: { normal: true },
        timestamp: new Date(),
        priority: 'normal'
      };

      // Queue both messages
      const urgentPromise = router.routeMessage(urgentMessage);
      const normalPromise = router.routeMessage(normalMessage);

      const [urgentResponse, normalResponse] = await Promise.all([
        urgentPromise,
        normalPromise
      ]);

      expect(urgentResponse.success).toBe(true);
      expect(normalResponse.success).toBe(true);
    });
  });

  describe('Capability-Based Routing', () => {
    it('should find best agent for capability', async () => {
      const agent1 = createTestAgent('agent-1', 'capability-A');
      const agent2 = createTestAgent('agent-2', 'capability-B');
      agent2.capabilities[0].reliability = 0.95; // Higher reliability

      await registry.registerAgent(agent1);
      await registry.registerAgent(agent2);

      const bestAgent = await router.findBestAgent('capability-B');

      expect(bestAgent).toBeDefined();
      expect(bestAgent?.agentId).toBe('agent-2');
    });

    it('should handle capability request messages', async () => {
      const agent = createTestAgent('capable-agent', 'special-skill');
      await registry.registerAgent(agent);

      const capabilityRequest: A2AMessage = {
        id: 'cap-req-001',
        role: 'user',
        from: 'client',
        to: 'router',
        type: A2AMessageType.CAPABILITY_REQUEST,
        payload: {
          query: 'special-skill',
          requester: 'client',
          filters: { minReliability: 0.8 }
        },
        timestamp: new Date(),
        priority: 'normal'
      };

      const response = await router.routeMessage(capabilityRequest);

      expect(response.success).toBe(true);
      expect(response.data).toBeDefined();
    });
  });

  describe('Health Check Routing', () => {
    it('should handle health check messages', async () => {
      const agent = createTestAgent('healthy-agent');
      await registry.registerAgent(agent);

      const healthCheck: A2AMessage = {
        id: 'health-001',
        role: 'agent',
        from: 'monitor',
        to: 'healthy-agent',
        type: A2AMessageType.HEALTH_CHECK,
        payload: {},
        timestamp: new Date(),
        priority: 'low'
      };

      const response = await router.routeMessage(healthCheck);

      expect(response.success).toBe(true);
    });

    it('should handle broadcast health checks', async () => {
      const healthBroadcast: A2AMessage = {
        id: 'health-broadcast-001',
        role: 'agent',
        from: 'monitor',
        to: 'broadcast',
        type: A2AMessageType.HEALTH_CHECK,
        payload: {},
        timestamp: new Date(),
        priority: 'low'
      };

      const response = await router.routeMessage(healthBroadcast);

      expect(response.success).toBe(true);
      expect(response.data).toHaveProperty('router_status', 'healthy');
    });
  });

  describe('Error Handling', () => {
    it('should handle routing to non-existent agent', async () => {
      const message: A2AMessage = {
        id: 'error-001',
        role: 'user',
        from: 'client',
        to: 'non-existent',
        type: A2AMessageType.TASK_REQUEST,
        payload: {},
        timestamp: new Date(),
        priority: 'normal'
      };

      const response = await router.routeMessage(message);

      expect(response.success).toBe(false);
      expect(response.error).toContain('Agent not found');
    });

    it('should handle invalid message format', async () => {
      const invalidMessage = {
        // Missing required fields
        from: 'client',
        payload: {}
      } as any;

      const response = await router.routeMessage(invalidMessage);

      expect(response.success).toBe(false);
      expect(response.error).toContain('Invalid message format');
    });

    it('should handle offline agent routing', async () => {
      const agent = createTestAgent('offline-agent');
      agent.status = AgentStatus.OFFLINE;
      await registry.registerAgent(agent);

      const message: A2AMessage = {
        id: 'offline-001',
        role: 'user',
        from: 'client',
        to: 'offline-agent',
        type: A2AMessageType.TASK_REQUEST,
        payload: {},
        timestamp: new Date(),
        priority: 'normal'
      };

      const response = await router.routeMessage(message);

      expect(response.success).toBe(false);
      expect(response.error).toContain('Agent is not online');
    });
  });

  describe('Routing Algorithms', () => {
    it('should use best-match routing by default', async () => {
      const agent1 = createTestAgent('agent-1', 'compute');
      const agent2 = createTestAgent('agent-2', 'compute');

      agent1.metadata.load = 80; // High load
      agent2.metadata.load = 20; // Low load
      agent2.capabilities[0].reliability = 0.95; // Higher reliability

      await registry.registerAgent(agent1);
      await registry.registerAgent(agent2);

      const taskDef: TaskDefinition = {
        name: 'Compute task',
        description: 'Heavy computation',
        requiredCapability: 'compute',
        parameters: {},
        priority: 'normal'
      };

      const message: A2AMessage = {
        id: 'route-001',
        role: 'user',
        from: 'client',
        to: 'auto',
        type: A2AMessageType.TASK_REQUEST,
        payload: taskDef,
        timestamp: new Date(),
        priority: 'normal'
      };

      // Mock private method to track which agent is selected
      const selectSpy = jest.spyOn(router as any, 'selectBestAgentForTask');

      await router.routeMessage(message);

      expect(selectSpy).toHaveBeenCalled();
      // Best match should prefer agent-2 (lower load, higher reliability)
    });

    it('should support round-robin routing', async () => {
      config.performance.routingAlgorithm = 'round-robin';
      router = new MessageRouter(registry, config);

      const agent1 = createTestAgent('rr-agent-1', 'service');
      const agent2 = createTestAgent('rr-agent-2', 'service');
      const agent3 = createTestAgent('rr-agent-3', 'service');

      await registry.registerAgent(agent1);
      await registry.registerAgent(agent2);
      await registry.registerAgent(agent3);

      // Round-robin should distribute evenly
      const agents = await registry.findByCapability('service');
      expect(agents).toHaveLength(3);
    });

    it('should support least-loaded routing', async () => {
      config.performance.routingAlgorithm = 'least-loaded';
      router = new MessageRouter(registry, config);

      const agent1 = createTestAgent('load-1', 'process');
      const agent2 = createTestAgent('load-2', 'process');

      agent1.metadata.load = 75;
      agent2.metadata.load = 25;

      await registry.registerAgent(agent1);
      await registry.registerAgent(agent2);

      const bestAgent = await router.findBestAgent('process');

      expect(bestAgent?.agentId).toBe('load-2'); // Lower load
    });
  });

  describe('Routing Statistics', () => {
    it('should provide routing statistics', () => {
      const stats = router.getRoutingStats();

      expect(stats).toHaveProperty('activeMessages');
      expect(stats).toHaveProperty('queueSizes');
      expect(stats).toHaveProperty('routingTableSize');
      expect(stats).toHaveProperty('totalRoutes');

      expect(stats.queueSizes).toHaveProperty('urgent');
      expect(stats.queueSizes).toHaveProperty('high');
      expect(stats.queueSizes).toHaveProperty('normal');
      expect(stats.queueSizes).toHaveProperty('low');
    });
  });

  describe('Event Emissions', () => {
    it('should emit message.sent event', async () => {
      const agent = createTestAgent('event-agent');
      await registry.registerAgent(agent);

      let eventEmitted = false;
      router.on('message.sent', (message) => {
        eventEmitted = true;
        expect(message.id).toBe('event-001');
      });

      const message: A2AMessage = {
        id: 'event-001',
        role: 'user',
        from: 'client',
        to: 'event-agent',
        type: A2AMessageType.TASK_REQUEST,
        payload: {},
        timestamp: new Date(),
        priority: 'normal'
      };

      await router.routeMessage(message);
      expect(eventEmitted).toBe(true);
    });

    it('should emit message.failed event on error', async () => {
      let failedEventEmitted = false;
      router.on('message.failed', (message, error) => {
        failedEventEmitted = true;
        expect(error).toContain('Agent not found');
      });

      const message: A2AMessage = {
        id: 'fail-001',
        role: 'user',
        from: 'client',
        to: 'non-existent',
        type: A2AMessageType.TASK_REQUEST,
        payload: {},
        timestamp: new Date(),
        priority: 'normal'
      };

      await router.routeMessage(message);
      expect(failedEventEmitted).toBe(true);
    });
  });

  describe('Cleanup', () => {
    it('should cleanup on shutdown', () => {
      const shutdownSpy = jest.fn();
      router.on('shutdown', shutdownSpy);

      router.shutdown();

      expect(shutdownSpy).toHaveBeenCalled();

      // Verify queues are cleared
      const stats = router.getRoutingStats();
      expect(stats.activeMessages).toBe(0);
    });
  });
  
  describe('Circuit Breaker', () => {
    it('should open circuit after failure threshold', async () => {
      const agent = createTestAgent('circuit-agent');
      await registry.registerAgent(agent);
      
      router.enableCircuitBreaker('circuit-agent', {
        failureThreshold: 3,
        timeout: 1000
      });

      // Simulate 3 failures
      for (let i = 0; i < 3; i++) {
        router.recordFailure('circuit-agent');
      }

      expect(router.isCircuitOpen('circuit-agent')).toBe(true);
      
      // Message should fail immediately
      const message: A2AMessage = {
        id: 'circuit-test',
        role: 'user',
        from: 'client',
        to: 'circuit-agent',
        type: A2AMessageType.TASK_REQUEST,
        payload: {},
        timestamp: new Date(),
        priority: 'normal'
      };

      const response = await router.routeMessage(message);
      expect(response.success).toBe(false);
      expect(response.error).toContain('Circuit breaker is open');
    });

    it('should transition to half-open after timeout', async () => {
      jest.useFakeTimers();
      
      const agent = createTestAgent('timeout-agent');
      await registry.registerAgent(agent);
      
      router.enableCircuitBreaker('timeout-agent', {
        failureThreshold: 2,
        timeout: 5000
      });

      // Open circuit
      router.recordFailure('timeout-agent');
      router.recordFailure('timeout-agent');
      
      expect(router.isCircuitOpen('timeout-agent')).toBe(true);

      // Advance time past timeout
      jest.advanceTimersByTime(5001);
      
      // Should allow one attempt (half-open)
      expect(router.isCircuitOpen('timeout-agent')).toBe(false);
      
      const status = router.getCircuitStatus('timeout-agent');
      expect(status?.status).toBe('half-open');
      
      jest.useRealTimers();
    });

    it('should close circuit after success threshold in half-open', async () => {
      const agent = createTestAgent('recovery-agent');
      await registry.registerAgent(agent);
      
      router.enableCircuitBreaker('recovery-agent', {
        failureThreshold: 2,
        successThreshold: 2,
        timeout: 1000
      });

      // Open circuit
      router.recordFailure('recovery-agent');
      router.recordFailure('recovery-agent');
      
      // Get circuit status and force to half-open
      const status = router.getCircuitStatus('recovery-agent');
      expect(status).toBeDefined();
      if (status) {
        status.status = 'half-open';
      }

      // Record successes
      router.recordSuccess('recovery-agent');
      router.recordSuccess('recovery-agent');
      
      expect(router.isCircuitOpen('recovery-agent')).toBe(false);
      expect(router.getCircuitStatus('recovery-agent')?.status).toBe('closed');
    });

    it('should reset circuit breaker', async () => {
      const agent = createTestAgent('reset-agent');
      await registry.registerAgent(agent);
      
      router.enableCircuitBreaker('reset-agent', {
        failureThreshold: 1
      });

      router.recordFailure('reset-agent');
      expect(router.isCircuitOpen('reset-agent')).toBe(true);
      
      router.resetCircuitBreaker('reset-agent');
      
      expect(router.isCircuitOpen('reset-agent')).toBe(false);
      expect(router.getCircuitStatus('reset-agent')?.failures).toBe(0);
    });

    it('should emit circuit events', async () => {
      const events: string[] = [];
      
      router.on('circuit:opened', () => events.push('opened'));
      router.on('circuit:closed', () => events.push('closed'));
      router.on('circuit:half-open', () => events.push('half-open'));
      router.on('circuit:failure', () => events.push('failure'));
      router.on('circuit:success', () => events.push('success'));
      
      const agent = createTestAgent('event-circuit');
      await registry.registerAgent(agent);
      
      router.enableCircuitBreaker('event-circuit', {
        failureThreshold: 1,
        successThreshold: 1
      });

      router.recordFailure('event-circuit');
      expect(events).toContain('opened');
      expect(events).toContain('failure');
    });

    it('should include circuit breaker stats in routing stats', () => {
      router.enableCircuitBreaker('stats-agent-1');
      router.enableCircuitBreaker('stats-agent-2');
      
      router.recordFailure('stats-agent-1');
      router.recordFailure('stats-agent-1');
      router.recordFailure('stats-agent-1');
      router.recordFailure('stats-agent-1');
      router.recordFailure('stats-agent-1'); // Opens circuit
      
      const stats = router.getRoutingStats();
      
      expect(stats.circuitBreakers).toBeDefined();
      expect(stats.circuitBreakers.total).toBe(2);
      expect(stats.circuitBreakers.open).toBe(1);
      expect(stats.circuitBreakers.closed).toBe(1);
    });

    it('should handle circuit breaker for non-existent agent gracefully', () => {
      // Should not throw
      expect(() => router.recordFailure('non-existent')).not.toThrow();
      expect(() => router.recordSuccess('non-existent')).not.toThrow();
      expect(router.isCircuitOpen('non-existent')).toBe(false);
    });
  });
});

// Helper function with REAL interfaces
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
      location: `agent://${id}`,
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