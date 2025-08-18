/**
 * Test suite for A2AProtocol
 */


// tests/unit/protocols/a2a/A2AProtocol.test.ts
import { A2AProtocol } from '../../../../protocols/src/a2a/A2AProtocol';
import { A2AAgentServer } from '../../../../protocols/src/a2a/A2AAgentServer';
import { RegistryService } from '../../../../protocols/src/a2a/RegistryService';
import { HybridDiscovery } from '../../../../protocols/src/a2a/HybridDiscovery';
import { MessageRouter } from '../../../../protocols/src/a2a/MessageRouter';
import { A2AAgentRegistry } from '../../../../protocols/src/a2a/A2AAgentRegistry';
import { SecurityManager } from '../../../../protocols/src/a2a/SecurityManager';
import {
  AgentProfile,
  AgentStatus,
  Message,
  Task,
  TaskDefinition,
  TaskStatus,
  TaskState,
  CapabilityCategory,
  A2APriority,
  AgentCard,
  TransportProtocol,
  TextPart,
  A2AMessage,
  A2AMessageType

} from '../../../../protocols/src/a2a/types';

import { A2AProtocolConfig } from '../../../../protocols/src/a2a/A2AProtocol';

describe('A2AProtocol Core Functionality', () => {
  let protocol: A2AProtocol;
  let mockAgentCard: AgentCard;
  let config: A2AProtocolConfig;

  beforeEach(async () => {
    mockAgentCard = {
      protocolVersion: '1.0.0',
      name: 'test-agent-main',
      description: 'Main test agent',
      url: 'http://localhost:8080',
      preferredTransport: TransportProtocol.JSONRPC,
      skills: [],
      capabilities: [
        {
          id: 'cap-1',
          name: 'analysis',
          description: 'Data analysis capability',
          category: CapabilityCategory.ANALYSIS,
          inputs: [],
          outputs: [],
          cost: 50,
          reliability: 0.95,
          version: '1.0.0'
        }
      ],
      systemFeatures: {
        streaming: true,
        pushNotifications: true
      }
    };

    config = {
      agentCard: mockAgentCard,
      discovery: false, // Disabled by default for unit tests
      network: {
        timeout: 5000,
        retries: 2
      }
    };
    
    protocol = new A2AProtocol(config);
  });

  afterEach(async () => {
    await protocol.shutdown();
  });

  describe('Protocol Initialization', () => {
    it('should initialize with minimal config', () => {
      expect(() => new A2AProtocol(config)).not.toThrow();
    });

    it('should initialize registry and router', () => {
      const testProtocol = new A2AProtocol(config);
      
      // Verify internal components are initialized
      expect((testProtocol as any).registry).toBeDefined();
      expect((testProtocol as any).router).toBeDefined();
      expect((testProtocol as any).securityManager).toBeDefined();
    });

    it('should setup event handlers', () => {
      const eventSpy = jest.fn();
      const testProtocol = new A2AProtocol(config);
      
      testProtocol.on('agent:registered', eventSpy);
      testProtocol.registerAgent({
        agentId: 'test-1',
        agentType: 'test',
        status: AgentStatus.ONLINE,
        capabilities: [],
        systemFeatures: {},
        metadata: {} as any,
        lastSeen: new Date()
      });

      expect(eventSpy).toHaveBeenCalled();
    });
  });

  describe('Message Routing', () => {
    it('should route messages through MessageRouter', async () => {
      const message: A2AMessage = {
        id: 'msg-1',
        role: 'agent',
        from: 'agent-1',
        to: 'agent-2',
        type: A2AMessageType.TASK_REQUEST,
        payload: { test: true },
        timestamp: new Date(),
        priority: 'normal'
      };

      const routerSpy = jest.spyOn((protocol as any).router, 'routeMessage');
      await protocol.routeMessage(message);

      expect(routerSpy).toHaveBeenCalledWith(message);
    });

    it('should broadcast messages', async () => {
      const message: A2AMessage = {
        id: 'msg-2',
        role: 'agent',
        from: 'agent-1',
        to: 'broadcast',
        type: A2AMessageType.AGENT_ANNOUNCE,
        payload: { announcement: 'Hello' },
        timestamp: new Date(),
        priority: 'low'
      };

      const routerSpy = jest.spyOn((protocol as any).router, 'broadcastMessage');
      await protocol.broadcastMessage(message);

      expect(routerSpy).toHaveBeenCalledWith(message);
    });
  });

  describe('Agent Registration', () => {
    it('should register an agent successfully', async () => {
      const profile: AgentProfile = createTestAgentProfile('test-agent-001');

      protocol.registerAgent(profile);
      const agents = protocol.getRegisteredAgents();

      expect(agents).toHaveLength(1);
      expect(agents[0].agentId).toBe('test-agent-001');
    });

    it('should emit agent:registered event', async () => {
      const mockListener = jest.fn();
      protocol.on('agent:registered', mockListener);

      const profile = createTestAgentProfile('test-agent-002');
      protocol.registerAgent(profile);

      expect(mockListener).toHaveBeenCalled();
      expect(mockListener).toHaveBeenCalledWith(expect.objectContaining({
        agentId: 'test-agent-002',
        profile: expect.any(Object),
        timestamp: expect.any(Number)
      }));
    });

    it('should handle duplicate agent registration', async () => {
      const profile = createTestAgentProfile('test-agent-003');

      protocol.registerAgent(profile);

      // Registry returns {success: false} for duplicates
      const result = await protocol['registry'].registerAgent(profile);
      expect(result.success).toBe(false);
      expect(result.error).toContain('already registered');
    });

    it('should update agent status', async () => {
      const profile = createTestAgentProfile('test-agent-004');
      protocol.registerAgent(profile);

      await protocol['registry'].updateStatus('test-agent-004', AgentStatus.BUSY);
      const agent = await protocol['registry'].getAgent('test-agent-004');

      expect(agent?.status).toBe(AgentStatus.BUSY);
    });
  });

  describe('Message Sending with Real Interfaces', () => {
    it('should send message with correct Message interface', async () => {
      const agent1 = createTestAgentProfile('agent-1');
      const agent2 = createTestAgentProfile('agent-2');

      protocol.registerAgent(agent1);
      protocol.registerAgent(agent2);

      const responseMessage: Message = {
        role: 'agent',
        parts: [{ kind: 'text', text: 'Response from agent-2' }],
        messageId: '456',
        kind: 'message'
      };

      jest.spyOn(protocol as any, 'sendSecureJSONRPC').mockResolvedValue({
        jsonrpc: '2.0',
        id: '123',
        result: responseMessage
      });

      const message: Message = {
        role: 'user',
        parts: [{ kind: 'text', text: 'Hello agent-2' }],
        messageId: '123',
        kind: 'message'
      };

      const result = await protocol.sendMessage('agent-2', message);
      expect(result).toBeDefined();
      expect((result as Message).kind).toBe('message');
      expect((result as Message).role).toBe('agent');
    });

    it('should handle Task response from sendMessage', async () => {
      const agent = createTestAgentProfile('task-agent');
      protocol.registerAgent(agent);

      const mockTask: Task = {
        id: 'task-001',
        contextId: 'ctx-001',
        status: {
          state: 'submitted' as TaskState,
          timestamp: new Date().toISOString()
        },
        createdAt: new Date(),
        updatedAt: new Date(),
        kind: 'task'
      };

      jest.spyOn(protocol as any, 'sendSecureJSONRPC').mockResolvedValue({
        jsonrpc: '2.0',
        id: '123',
        result: mockTask
      });

      const message: Message = {
        role: 'user',
        parts: [{ kind: 'text', text: 'Create task' }],
        messageId: '123',
        kind: 'message'
      };

      const result = await protocol.sendMessage('task-agent', message);
      expect(result).toBeDefined();
      expect((result as Task).kind).toBe('task');
      expect((result as Task).id).toBe('task-001');
    });
  });

  describe('Task Management with Real Interfaces', () => {
    it('should create task with TaskDefinition and return Task', async () => {
      const agent = createTestAgentProfile('task-agent');
      protocol.registerAgent(agent);

      const taskDef: TaskDefinition = {
        name: 'Test Task',
        description: 'Test task description',
        targetAgent: 'task-agent',
        requiredCapability: 'test-capability',
        parameters: { test: 'value' },
        priority: 'normal' as A2APriority,
        timeout: 30000,
        retries: 3
      };

      const taskId = await protocol.createTask(taskDef);
      expect(taskId).toBeDefined();
      expect(typeof taskId).toBe('string');

      // Get the full Task
      const task = await protocol.getTask(taskId);
      expect(task).toBeDefined();
      expect(task.kind).toBe('task');
      expect(task.status.state).toBe('submitted');
      expect(task.executedBy).toBe('task-agent');
      expect(task.metadata?.definition).toEqual(taskDef);
    });

    it('should get TaskStatus from a task', async () => {
      const agent = createTestAgentProfile('status-agent');
      protocol.registerAgent(agent);

      const taskDef: TaskDefinition = {
        name: 'Status Task',
        description: 'Test task status',
        targetAgent: 'status-agent',
        requiredCapability: 'test',
        parameters: {},
        priority: 'normal'
      };

      const taskId = await protocol.createTask(taskDef);

      // Get TaskStatus (not Task)
      const status: TaskStatus = await protocol.getTaskStatus(taskId);
      expect(status).toBeDefined();
      expect(status.state).toBe('submitted');
      expect(status.timestamp).toBeDefined();
      expect(status.message).toBeUndefined(); // No message initially
    });

    it('should update task progress and add Message to TaskStatus', async () => {
      const agent = createTestAgentProfile('progress-agent');
      protocol.registerAgent(agent);

      const taskDef: TaskDefinition = {
        name: 'Progress Task',
        description: 'Task with progress tracking',
        targetAgent: 'progress-agent',
        requiredCapability: 'test',
        parameters: {},
        priority: 'normal'
      };

      const taskId = await protocol.createTask(taskDef);

      // Update progress
      await protocol.updateTaskProgress(taskId, 50, 'Half way done');

      // Get TaskStatus
      const status: TaskStatus = await protocol.getTaskStatus(taskId);
      expect(status.state).toBe('in-progress');
      expect(status.timestamp).toBeDefined();

      // Check that message is a real Message object
      expect(status.message).toBeDefined();
      expect(status.message?.kind).toBe('message');
      expect(status.message?.role).toBe('agent');
      expect(status.message?.parts).toHaveLength(1);
      expect(status.message?.parts[0].kind).toBe('text');
      expect((status.message?.parts[0] as TextPart).text).toBe('Half way done');

      // Check progress in Task metadata
      const task = await protocol.getTask(taskId);
      expect(task.metadata?.progress).toBe(50);
    });

    it('should complete task when progress is 100', async () => {
      const agent = createTestAgentProfile('complete-agent');
      protocol.registerAgent(agent);

      const taskDef: TaskDefinition = {
        name: 'Complete Task',
        description: 'Task to complete',
        targetAgent: 'complete-agent',
        requiredCapability: 'test',
        parameters: {},
        priority: 'high'
      };

      const taskId = await protocol.createTask(taskDef);

      // Complete the task
      await protocol.updateTaskProgress(taskId, 100, 'Task completed successfully');

      // Check TaskStatus
      const status: TaskStatus = await protocol.getTaskStatus(taskId);
      expect(status.state).toBe('completed');
      expect(status.message).toBeDefined();
      expect((status.message?.parts[0] as TextPart).text).toBe('Task completed successfully');

      // Check full Task
      const task = await protocol.getTask(taskId);
      expect(task.status.state).toBe('completed');
      expect(task.metadata?.progress).toBe(100);
    });

    it('should handle Task with complete structure', async () => {
      const agent = createTestAgentProfile('complete-task-agent');
      protocol.registerAgent(agent);

      const completeTask: Task = {
        id: 'task-002',
        contextId: 'ctx-002',
        status: {
          state: 'in-progress',
          message: {
            role: 'agent',
            parts: [{ kind: 'text', text: 'Processing...' }],
            messageId: 'msg-001',
            kind: 'message'
          },
          timestamp: new Date().toISOString()
        },
        history: [
          {
            role: 'user',
            parts: [{ kind: 'text', text: 'Start processing' }],
            messageId: 'msg-000',
            kind: 'message'
          }
        ],
        artifacts: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        executedBy: 'complete-task-agent',
        metadata: { custom: 'data' },
        kind: 'task'
      };

      // Store task directly
      protocol['tasks'].set(completeTask.id, completeTask);

      // Mock getTask response
      jest.spyOn(protocol as any, 'sendSecureJSONRPC').mockResolvedValue({
        jsonrpc: '2.0',
        id: '123',
        result: completeTask
      });

      const retrievedTask = await protocol.getTask('task-002');
      expect(retrievedTask.id).toBe('task-002');
      expect(retrievedTask.status.state).toBe('in-progress');
      expect(retrievedTask.executedBy).toBe('complete-task-agent');
      expect(retrievedTask.history).toHaveLength(1);
      expect(retrievedTask.status.message).toBeDefined();
      expect((retrievedTask.status.message?.parts[0] as TextPart).text).toBe('Processing...');
    });
  });

  describe('Capability Discovery', () => {
    it('should find agents by capability using registry', async () => {
      const agent1 = createTestAgentProfile('calc-agent', 'calculator');
      const agent2 = createTestAgentProfile('data-agent', 'data-analysis');

      protocol.registerAgent(agent1);
      protocol.registerAgent(agent2);

      const calcAgents = await protocol.findAgentsByCapability('calculator');
      expect(calcAgents).toHaveLength(1);
      expect(calcAgents[0].agentId).toBe('calc-agent');
    });

    it('should find agents with multiple capabilities', async () => {
      const agent = createTestAgentProfile('multi-agent');
      agent.capabilities.push({
        id: 'analysis',
        name: 'analysis',  // Changed to match the search term
        description: 'Analyze data',
        category: CapabilityCategory.ANALYSIS,
        inputs: [],
        outputs: [],
        cost: 20,
        reliability: 0.9,
        version: '1.0.0'
      });

      protocol.registerAgent(agent);

      // Test finding by single capability
      const testAgents = await protocol.findAgentsByCapability('test-capability');
      expect(testAgents).toHaveLength(1);

      const analysisAgents = await protocol.findAgentsByCapability('analysis');
      expect(analysisAgents).toHaveLength(1);

      // Test finding by multiple capabilities
      const capabilities = ['test-capability', 'analysis'];
      const agents = await protocol['registry'].findByCapability(capabilities);
      expect(agents).toHaveLength(1);
      expect(agents[0].agentId).toBe('multi-agent');
    });

    it('should return empty array for non-existent capability', async () => {
      const agents = await protocol.findAgentsByCapability('non-existent');
      expect(agents).toHaveLength(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle agent not found error correctly', async () => {
      const message: Message = {
        role: 'user',
        parts: [{ kind: 'text', text: 'Test' }],
        messageId: '123',
        kind: 'message'
      };

      await expect(protocol.sendMessage('non-existent', message))
          .rejects.toThrow('Agent not found');
    });

    it('should handle JSONRPC errors', async () => {
      const agent = createTestAgentProfile('error-agent');
      protocol.registerAgent(agent);

      jest.spyOn(protocol as any, 'sendSecureJSONRPC').mockResolvedValue({
        jsonrpc: '2.0',
        id: '123',
        error: {
          code: -1005,
          message: 'Task not found'
        }
      });

      const message: Message = {
        role: 'user',
        parts: [{ kind: 'text', text: 'Test' }],
        messageId: '123',
        kind: 'message'
      };

      await expect(protocol.sendMessage('error-agent', message))
          .rejects.toThrow('Task not found');
    });

    it('should handle connection errors', async () => {
      const agent = createTestAgentProfile('connection-error-agent');
      protocol.registerAgent(agent);

      jest.spyOn(protocol as any, 'sendSecureJSONRPC')
          .mockRejectedValue(new Error('Connection failed'));

      const message: Message = {
        role: 'user',
        parts: [{ kind: 'text', text: 'Test' }],
        messageId: '123',
        kind: 'message'
      };

      await expect(protocol.sendMessage('connection-error-agent', message))
          .rejects.toThrow('Connection failed');
    });
  });

  describe('Cleanup', () => {
    it('should cleanup inactive agents using registry', async () => {
      jest.useFakeTimers();

      const agent = createTestAgentProfile('inactive-agent');
      agent.lastSeen = new Date(Date.now() - 3600000); // 1 hour ago

      protocol.registerAgent(agent);

      await protocol.cleanupInactiveAgents(1800000); // 30 minutes threshold

      const agents = protocol.getRegisteredAgents();
      expect(agents).toHaveLength(0);

      jest.useRealTimers();
    });

    it('should properly shutdown all components', async () => {
      const agent1 = createTestAgentProfile('shutdown-1');
      const agent2 = createTestAgentProfile('shutdown-2');

      protocol.registerAgent(agent1);
      protocol.registerAgent(agent2);

      // Add a task
      const taskDef: TaskDefinition = {
        name: 'Shutdown Task',
        description: 'Task before shutdown',
        targetAgent: 'shutdown-1',
        requiredCapability: 'test',
        parameters: {},
        priority: 'normal'
      };

      await protocol.createTask(taskDef);

      // Verify before shutdown
      expect(protocol.getRegisteredAgents()).toHaveLength(2);
      expect(protocol.getActiveTasks()).toHaveLength(1);

      await protocol.shutdown();

      // Verify after shutdown
      expect(protocol.getRegisteredAgents()).toHaveLength(0);
      expect(protocol.getActiveTasks()).toHaveLength(0);
    });
  });

  // describe('Security Management', () => {
  //   it('should validate authentication for secure messages', async () => {
  //     const securitySpy = jest.spyOn((protocol as any).securityManager, 'getAuthHeaders');
  //
  //     const agent = createTestAgentProfile('secure-agent');
  //     protocol.registerAgent(agent);
  //
  //     const message: Message = {
  //       role: 'user',
  //       parts: [{ kind: 'text', text: 'Secure message' }],
  //       messageId: 'sec-1',
  //       kind: 'message'
  //     };
  //
  //     jest.spyOn(protocol as any, 'sendSecureJSONRPC').mockResolvedValue({
  //       jsonrpc: '2.0',
  //       id: 'sec-1',
  //       result: message
  //     });
  //
  //     await protocol.sendMessage('secure-agent', message);
  //
  //     expect(securitySpy).toHaveBeenCalled();
  //   });
  // });

  describe('Event Emissions', () => {
    it('should emit correct lifecycle events', async () => {
      const events: string[] = [];

      protocol.on('agent:registered', () => events.push('agent:registered'));
      protocol.on('agent:unregistered', () => events.push('agent:unregistered'));
      protocol.on('message:sent', () => events.push('message:sent'));
      protocol.on('task:created', () => events.push('task:created'));
      protocol.on('task:progress', () => events.push('task:progress'));

      // Register agent
      const agent = createTestAgentProfile('event-agent');
      protocol.registerAgent(agent);

      // Create task
      const taskDef: TaskDefinition = {
        name: 'Event Task',
        description: 'Test events',
        targetAgent: 'event-agent',
        requiredCapability: 'test',
        parameters: {},
        priority: 'normal'
      };

      const taskId = await protocol.createTask(taskDef);

      // Update task progress
      await protocol.updateTaskProgress(taskId, 50, 'Progress update');

      // Mock sendMessage
      jest.spyOn(protocol as any, 'sendSecureJSONRPC').mockResolvedValue({
        jsonrpc: '2.0',
        id: '999',
        result: {
          role: 'agent',
          parts: [],
          messageId: '999',
          kind: 'message'
        } as Message
      });

      await protocol.sendMessage('event-agent', {
        role: 'user',
        parts: [{ kind: 'text', text: 'Test' }],
        messageId: '888',
        kind: 'message'
      });

      // Unregister agent
      await protocol.unregisterAgent('event-agent');

      expect(events).toContain('agent:registered');
      expect(events).toContain('task:created');
      expect(events).toContain('task:progress');
      expect(events).toContain('message:sent');
      expect(events).toContain('agent:unregistered');
    });
  });
});

// Helper function with REAL interfaces
function createTestAgentProfile(id: string, capabilityName = 'test-capability'): AgentProfile {
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
      cost: 10,
      reliability: 0.95,
      version: '1.0.0'
    }],
    systemFeatures: {
      streaming: false,
      pushNotifications: false
    },
    metadata: {
      version: '1.0.0',
      location: `agent://${id}`,
      load: 0,
      uptime: Date.now(),
      capabilities_count: 1,
      registeredAt: new Date(),
      lastUpdated: new Date()
    },
    lastSeen: new Date(),
    networkAddress: `agent://${id}`
  };
}