import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { A2AAgentRegistry } from '../../../../protocols/src/a2a/A2AAgentRegistry';
import { AgentProfile, AgentStatus, CapabilityCategory, AgentSystemFeatures } from '../../../../protocols/src/a2a/types';
import { EventEmitter } from 'eventemitter3';

describe('A2AAgentRegistry', () => {
  let registry: A2AAgentRegistry;
  let mockEventBus: EventEmitter;

  beforeEach(() => {
    mockEventBus = new EventEmitter();
    registry = new A2AAgentRegistry(mockEventBus);
  });

  describe('Agent Registration', () => {
    it('should register a new agent', async () => {
      const profile = createAgentProfile('agent-001');
      
      const result = await registry.registerAgent(profile);
      
      expect(result.success).toBe(true);
      expect(result.agentId).toBe('agent-001');
      
      const agent = await registry.getAgent('agent-001');
      expect(agent).toEqual(profile);
    });

    it('should reject duplicate registration', async () => {
      const profile = createAgentProfile('duplicate-001');
      
      await registry.registerAgent(profile);
      const result = await registry.registerAgent(profile);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('already registered');
    });

    it('should validate agent profile before registration', async () => {
      const invalidProfile = {
        agentId: '',  // Invalid: empty ID
        agentType: 'Test',
        status: AgentStatus.ONLINE
      } as any;

      const result = await registry.registerAgent(invalidProfile);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid agent profile');
    });

    it('should emit registration event', async () => {
      const eventSpy = jest.fn();
      mockEventBus.on('agent:registered', eventSpy);

      const profile = createAgentProfile('event-agent');
      await registry.registerAgent(profile);

      expect(eventSpy).toHaveBeenCalledWith({
        agentId: 'event-agent',
        profile,
        timestamp: expect.any(Number)
      });
    });

    it('should update agent metadata on registration', async () => {
      const profile = createAgentProfile('metadata-agent');
      // @ts-ignore
      delete profile.metadata.registeredAt;

      await registry.registerAgent(profile);
      const agent = await registry.getAgent('metadata-agent');

      expect(agent?.metadata.registeredAt).toBeDefined();
      expect(agent?.metadata.registeredAt).toBeInstanceOf(Date);
    });
  });

  describe('Agent Discovery', () => {
    beforeEach(async () => {
      // Register test agents
      await registry.registerAgent(createAgentProfile('calc-agent', ['calculator', 'math']));
      await registry.registerAgent(createAgentProfile('data-agent', ['data-analysis', 'visualization']));
      await registry.registerAgent(createAgentProfile('ml-agent', ['machine-learning', 'prediction']));
      await registry.registerAgent(createAgentProfile('general-agent', ['general', 'fallback']));
    });

    it('should find agents by capability', async () => {
      const agents = await registry.findByCapability('calculator');
      
      expect(agents).toHaveLength(1);
      expect(agents[0].agentId).toBe('calc-agent');
    });

    it('should find agents by multiple capabilities', async () => {
      const agents = await registry.findByCapability(['data-analysis', 'visualization']);
      
      expect(agents).toHaveLength(1);
      expect(agents[0].agentId).toBe('data-agent');
    });

    it('should find agents by exact capability match', async () => {
      const agents = await registry.findByCapability('machine-learning');
      
      expect(agents).toHaveLength(1);
      expect(agents[0].agentId).toBe('ml-agent');
    });

    it('should find agents by type', async () => {
      await registry.registerAgent(createAgentProfile('worker-1', [], 'Worker'));
      await registry.registerAgent(createAgentProfile('worker-2', [], 'Worker'));

      const workers = await registry.findByType('Worker');
      
      expect(workers).toHaveLength(2);
      expect(workers.every(a => a.agentType === 'Worker')).toBe(true);
    });

    it('should find agents by status', async () => {
      const busyAgent = createAgentProfile('busy-agent');
      busyAgent.status = AgentStatus.BUSY;
      await registry.registerAgent(busyAgent);

      const onlineAgents = await registry.findByStatus(AgentStatus.ONLINE);
      const busyAgents = await registry.findByStatus(AgentStatus.BUSY);

      expect(onlineAgents.length).toBeGreaterThan(0);
      expect(busyAgents).toHaveLength(1);
      expect(busyAgents[0].agentId).toBe('busy-agent');
    });

    it('should find agents with complex queries', async () => {
      const query = {
        capabilities: ['data-analysis'],
        status: AgentStatus.ONLINE,
        agentType: 'TestAgent'
      };

      const agents = await registry.findByQuery(query);
      
      expect(agents).toHaveLength(1);
      expect(agents[0].agentId).toBe('data-agent');
    });

    it('should return empty array for non-matching queries', async () => {
      const agents = await registry.findByCapability('non-existent');
      
      expect(agents).toHaveLength(0);
    });
  });

  describe('Agent Updates', () => {
    it('should update agent status', async () => {
      const profile = createAgentProfile('status-agent');
      await registry.registerAgent(profile);

      await registry.updateStatus('status-agent', AgentStatus.BUSY);
      const agent = await registry.getAgent('status-agent');

      expect(agent?.status).toBe(AgentStatus.BUSY);
    });

    it('should update agent capabilities', async () => {
      const profile = createAgentProfile('cap-agent', ['old-capability']);
      await registry.registerAgent(profile);

      const newCapabilities = [{
        id: 'new-capability',
        name: 'New Capability',
        description: 'A new capability',
        category: CapabilityCategory.ANALYSIS,
        inputs: [],
        outputs: [],
        cost: 10,
        reliability: 0.95,
        version: '2.0.0'
      }];

      await registry.updateCapabilities('cap-agent', newCapabilities);
      const agent = await registry.getAgent('cap-agent');

      expect(agent?.capabilities).toHaveLength(1);
      expect(agent?.capabilities[0].id).toBe('new-capability');
    });

    it('should update last seen timestamp', async () => {
      jest.useFakeTimers();
      const now = new Date('2024-01-01T12:00:00Z');
      jest.setSystemTime(now);

      const profile = createAgentProfile('seen-agent');
      await registry.registerAgent(profile);

      jest.advanceTimersByTime(60000); // 1 minute later
      await registry.updateLastSeen('seen-agent');
      
      const agent = await registry.getAgent('seen-agent');
      expect(agent?.lastSeen.getTime()).toBeGreaterThan(now.getTime());

      jest.useRealTimers();
    });

    it('should emit update events', async () => {
      const eventSpy = jest.fn();
      mockEventBus.on('agent:updated', eventSpy);

      const profile = createAgentProfile('update-agent');
      await registry.registerAgent(profile);
      await registry.updateStatus('update-agent', AgentStatus.OFFLINE);

      expect(eventSpy).toHaveBeenCalledWith({
        agentId: 'update-agent',
        updates: { status: AgentStatus.OFFLINE },
        timestamp: expect.any(Number)
      });
    });

    it('should handle updates for non-existent agents', async () => {
      const result = await registry.updateStatus('non-existent', AgentStatus.BUSY);
      
      expect(result).toBeUndefined();
    });
  });

  describe('Agent Unregistration', () => {
    it('should unregister an agent', async () => {
      const profile = createAgentProfile('unreg-agent');
      await registry.registerAgent(profile);

      const result = await registry.unregisterAgent('unreg-agent');
      
      expect(result).toBe(true);
      
      const agent = await registry.getAgent('unreg-agent');
      expect(agent).toBeUndefined();
    });

    it('should emit unregistration event', async () => {
      const eventSpy = jest.fn();
      mockEventBus.on('agent:unregistered', eventSpy);

      const profile = createAgentProfile('event-unreg');
      await registry.registerAgent(profile);
      await registry.unregisterAgent('event-unreg');

      expect(eventSpy).toHaveBeenCalledWith({
        agentId: 'event-unreg',
        timestamp: expect.any(Number)
      });
    });

    it('should handle unregistration of non-existent agent', async () => {
      const result = await registry.unregisterAgent('non-existent');
      
      expect(result).toBe(false);
    });

    it('should clean up agent data on unregistration', async () => {
      const profile = createAgentProfile('cleanup-agent');
      await registry.registerAgent(profile);
      
      // Add some metadata
      await registry.setMetadata('cleanup-agent', 'customKey', 'customValue');
      
      await registry.unregisterAgent('cleanup-agent');
      
      const metadata = await registry.getMetadata('cleanup-agent');
      expect(metadata).toBeUndefined();
    });
  });

  describe('Agent Health Monitoring', () => {
    it('should track agent health status', async () => {
      const profile = createAgentProfile('health-agent');
      await registry.registerAgent(profile);

      await registry.updateHealth('health-agent', {
        cpu: 45,
        memory: 60,
        responseTime: 120,
        errorRate: 0.02
      });

      const health = await registry.getHealth('health-agent');
      
      expect(health?.cpu).toBe(45);
      expect(health?.memory).toBe(60);
      expect(health?.responseTime).toBe(120);
      expect(health?.errorRate).toBe(0.02);
    });

    it('should identify unhealthy agents', async () => {
      await registry.registerAgent(createAgentProfile('healthy-agent'));
      await registry.registerAgent(createAgentProfile('unhealthy-agent'));

      await registry.updateHealth('healthy-agent', {
        cpu: 30,
        memory: 40,
        responseTime: 50,
        errorRate: 0.01
      });

      await registry.updateHealth('unhealthy-agent', {
        cpu: 95,
        memory: 90,
        responseTime: 5000,
        errorRate: 0.15
      });

      const unhealthy = await registry.getUnhealthyAgents({
        maxCpu: 80,
        maxMemory: 80,
        maxResponseTime: 1000,
        maxErrorRate: 0.1
      });

      expect(unhealthy).toHaveLength(1);
      expect(unhealthy[0].agentId).toBe('unhealthy-agent');
    });

    it('should automatically mark unhealthy agents as degraded', async () => {
      const profile = createAgentProfile('degrade-agent');
      await registry.registerAgent(profile);

      await registry.updateHealth('degrade-agent', {
        cpu: 95,
        memory: 95,
        responseTime: 10000,
        errorRate: 0.5
      });

      await registry.checkHealthAndUpdateStatus('degrade-agent');
      
      const agent = await registry.getAgent('degrade-agent');
      expect(agent?.status).toBe(AgentStatus.DEGRADED);
    });
  });

  describe('Inactive Agent Cleanup', () => {
    it('should identify inactive agents', async () => {
      jest.useFakeTimers();
      const now = new Date();
      jest.setSystemTime(now);

      const activeAgent = createAgentProfile('active-agent');
      const inactiveAgent = createAgentProfile('inactive-agent');
      
      await registry.registerAgent(activeAgent);
      await registry.registerAgent(inactiveAgent);

      // Update active agent's last seen
      await registry.updateLastSeen('active-agent');

      // Set inactive agent's last seen to 1 hour ago
      jest.setSystemTime(new Date(now.getTime() - 3600000));
      await registry.updateLastSeen('inactive-agent');
      jest.setSystemTime(now);

      const inactive = await registry.getInactiveAgents(1800000); // 30 minutes threshold

      expect(inactive).toHaveLength(1);
      expect(inactive[0].agentId).toBe('inactive-agent');

      jest.useRealTimers();
    });

    it('should cleanup inactive agents', async () => {
      jest.useFakeTimers();
      const now = new Date();
      jest.setSystemTime(now);

      const agents = [
        createAgentProfile('agent-1'),
        createAgentProfile('agent-2'),
        createAgentProfile('agent-3')
      ];

      for (const agent of agents) {
        agent.lastSeen = new Date(now.getTime() - 7200000); // 2 hours ago
        await registry.registerAgent(agent);
      }

      const removed = await registry.cleanupInactive(3600000); // 1 hour threshold

      expect(removed).toHaveLength(3);
      
      const remaining = await registry.getAllAgents();
      expect(remaining).toHaveLength(0);

      jest.useRealTimers();
    });

    it('should emit cleanup events', async () => {
      const eventSpy = jest.fn();
      mockEventBus.on('agents:cleanup', eventSpy);

      jest.useFakeTimers();
      const now = new Date();
      jest.setSystemTime(now);

      const oldAgent = createAgentProfile('old-agent');
      oldAgent.lastSeen = new Date(now.getTime() - 7200000);
      await registry.registerAgent(oldAgent);

      await registry.cleanupInactive(3600000);

      expect(eventSpy).toHaveBeenCalledWith({
        removed: ['old-agent'],
        timestamp: expect.any(Number)
      });

      jest.useRealTimers();
    });
  });

  describe('Agent Metadata', () => {
    it('should store and retrieve custom metadata', async () => {
      const profile = createAgentProfile('meta-agent');
      await registry.registerAgent(profile);

      await registry.setMetadata('meta-agent', 'customField', 'customValue');
      await registry.setMetadata('meta-agent', 'numberField', 42);

      const metadata = await registry.getMetadata('meta-agent');
      
      expect(metadata?.customField).toBe('customValue');
      expect(metadata?.numberField).toBe(42);
    });

    it('should merge metadata updates', async () => {
      const profile = createAgentProfile('merge-agent');
      (profile.metadata as any) = { existing: 'value' };
      await registry.registerAgent(profile);

      await registry.mergeMetadata('merge-agent', {
        newField: 'newValue',
        anotherField: 123
      });

      const agent = await registry.getAgent('merge-agent');
      
      expect((agent?.metadata as any).existing).toBe('value');
      expect((agent?.metadata as any).newField).toBe('newValue');
      expect((agent?.metadata as any).anotherField).toBe(123);
    });

    it('should delete metadata fields', async () => {
      const profile = createAgentProfile('delete-meta');
      (profile.metadata as any) = { field1: 'value1', field2: 'value2' };
      await registry.registerAgent(profile);

      await registry.deleteMetadata('delete-meta', 'field1');

      const agent = await registry.getAgent('delete-meta');
      
      expect((agent?.metadata as any).field1).toBeUndefined();
      expect((agent?.metadata as any).field2).toBe('value2');
    });
  });

  describe('Registry Statistics', () => {
    it('should provide registry statistics', async () => {
      await registry.registerAgent(createAgentProfile('stat-1'));
      await registry.registerAgent(createAgentProfile('stat-2'));
      
      const busyAgent = createAgentProfile('stat-3');
      busyAgent.status = AgentStatus.BUSY;
      await registry.registerAgent(busyAgent);

      const stats = await registry.getStatistics();

      expect(stats.totalAgents).toBe(3);
      expect(stats.onlineAgents).toBe(2);
      expect(stats.busyAgents).toBe(1);
      expect(stats.offlineAgents).toBe(0);
    });

    it('should track capability distribution', async () => {
      await registry.registerAgent(createAgentProfile('cap-1', ['calc', 'math']));
      await registry.registerAgent(createAgentProfile('cap-2', ['calc', 'data']));
      await registry.registerAgent(createAgentProfile('cap-3', ['data', 'ml']));

      const distribution = await registry.getCapabilityDistribution();

      expect(distribution['calc']).toBe(2);
      expect(distribution['data']).toBe(2);
      expect(distribution['math']).toBe(1);
      expect(distribution['ml']).toBe(1);
    });
  });

  describe('Bulk Operations', () => {
    it('should register multiple agents in bulk', async () => {
      const agents = [
        createAgentProfile('bulk-1'),
        createAgentProfile('bulk-2'),
        createAgentProfile('bulk-3')
      ];

      const results = await registry.bulkRegister(agents);

      expect(results.successful).toBe(3);
      expect(results.failed).toBe(0);
      
      const allAgents = await registry.getAllAgents();
      expect(allAgents).toHaveLength(3);
    });

    it('should handle partial bulk registration failures', async () => {
      const agents = [
        createAgentProfile('bulk-ok-1'),
        createAgentProfile('bulk-ok-2'),
        { agentId: '', agentType: 'Invalid' } as any, // Invalid
        createAgentProfile('bulk-ok-3')
      ];

      const results = await registry.bulkRegister(agents);

      expect(results.successful).toBe(3);
      expect(results.failed).toBe(1);
      expect(results.errors).toHaveLength(1);
    });

    it('should unregister multiple agents in bulk', async () => {
      const agents = [
        createAgentProfile('bulk-del-1'),
        createAgentProfile('bulk-del-2'),
        createAgentProfile('bulk-del-3')
      ];

      await registry.bulkRegister(agents);
      
      const results = await registry.bulkUnregister(['bulk-del-1', 'bulk-del-2', 'bulk-del-3']);

      expect(results.successful).toBe(3);
      expect(results.failed).toBe(0);
      
      const remaining = await registry.getAllAgents();
      expect(remaining).toHaveLength(0);
    });
  });
});

// Helper function to create test agent profiles
function createAgentProfile(
  id: string, 
  capabilities: string[] = ['test'],
  type: string = 'TestAgent'
): AgentProfile {
  return {
    agentId: id,
    agentType: type,
    status: AgentStatus.ONLINE,
    capabilities: capabilities.map(cap => ({
      id: cap,
      name: cap,
      description: `${cap} capability`,
      category: CapabilityCategory.ANALYSIS,
      inputs: [],
      outputs: [],
      cost: 10,
      reliability: 0.95,
      version: '1.0.0'
    })),
    systemFeatures: {
      streaming: false,
      pushNotifications: false
    },
    metadata: {
      registeredAt: new Date(),
      lastUpdated: new Date(),
      version: '1.0.0',
      location: `agent://${id}`,
      load: 0,
      uptime: Date.now(),
      capabilities_count: capabilities.length
    } as any,
    lastSeen: new Date(),
    networkAddress: `agent://${id}`,



  };
}