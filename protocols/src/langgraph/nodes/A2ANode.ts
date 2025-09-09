import { WorkflowNode, WorkflowState } from '../types';
import { HumanMessage, AIMessage } from '@langchain/core/messages';

/**
 * A2ANode - Reusable workflow nodes for A2A agent communication
 */
export class A2ANode {
  /**
   * Create a node that sends a message to a specific agent
   */
  static createSendMessageNode(agentId: string, options?: {
    messageType?: string;
    task?: string;
    timeout?: number;
  }): WorkflowNode {
    return {
      id: `a2a-send-${agentId}`,
      type: 'agent',
      name: `Send to ${agentId}`,
      function: async (state: WorkflowState) => {
        // Extract message from state
        const lastMessage = state.messages?.slice(-1)[0];
        const messageContent = lastMessage?.content || state.context?.message;
        
        return {
          context: {
            ...state.context,
            pendingAgentCall: {
              agentId,
              message: messageContent,
              task: options?.task,
              messageType: options?.messageType || 'TASK_REQUEST'
            }
          }
        };
      },
      timeout: options?.timeout,
      metadata: { 
        agentId,
        messageType: options?.messageType || 'TASK_REQUEST',
        task: options?.task
      }
    };
  }
  
  /**
   * Create a node that broadcasts a message to all available agents
   */
  static createBroadcastNode(options?: {
    messageType?: string;
    filterByCapability?: string;
    waitForResponses?: boolean;
    timeout?: number;
  }): WorkflowNode {
    return {
      id: 'a2a-broadcast',
      type: 'agent',
      name: 'Broadcast to all agents',
      function: async (state: WorkflowState) => {
        const lastMessage = state.messages?.slice(-1)[0];
        const messageContent = lastMessage?.content || state.context?.message;
        
        return {
          context: {
            ...state.context,
            broadcast: {
              message: messageContent,
              messageType: options?.messageType || 'BROADCAST',
              filterByCapability: options?.filterByCapability,
              waitForResponses: options?.waitForResponses || false,
              timestamp: new Date()
            }
          }
        };
      },
      timeout: options?.timeout,
      metadata: {
        broadcast: true,
        messageType: options?.messageType || 'BROADCAST',
        filterByCapability: options?.filterByCapability,
        waitForResponses: options?.waitForResponses || false
      }
    };
  }
  
  /**
   * Create a node that discovers available agents
   */
  static createDiscoveryNode(options?: {
    capability?: string;
    skill?: string;
    maxAgents?: number;
  }): WorkflowNode {
    return {
      id: 'a2a-discovery',
      type: 'agent',
      name: 'Discover agents',
      function: async (state: WorkflowState) => {
        return {
          context: {
            ...state.context,
            discoveryRequest: {
              capability: options?.capability,
              skill: options?.skill,
              maxAgents: options?.maxAgents,
              timestamp: new Date()
            }
          }
        };
      },
      metadata: {
        discovery: true,
        capability: options?.capability,
        skill: options?.skill,
        maxAgents: options?.maxAgents
      }
    };
  }
  
  /**
   * Create a node that waits for agent responses
   */
  static createWaitForResponseNode(agentId: string, options?: {
    timeout?: number;
    retryOnTimeout?: boolean;
  }): WorkflowNode {
    return {
      id: `a2a-wait-${agentId}`,
      type: 'agent',
      name: `Wait for response from ${agentId}`,
      function: async (state: WorkflowState) => {
        // This would be handled by the adapter
        return {
          context: {
            ...state.context,
            waitingForAgent: {
              agentId,
              startTime: new Date(),
              timeout: options?.timeout || 30000
            }
          }
        };
      },
      timeout: options?.timeout || 30000,
      retryPolicy: options?.retryOnTimeout ? {
        maxAttempts: 3,
        backoffStrategy: 'exponential',
        initialDelay: 1000
      } : undefined,
      metadata: {
        agentId,
        waitForResponse: true
      }
    };
  }
  
  /**
   * Create a node that performs agent delegation
   */
  static createDelegationNode(options: {
    taskType: string;
    requiredCapabilities?: string[];
    maxAgents?: number;
    parallel?: boolean;
  }): WorkflowNode {
    return {
      id: `a2a-delegate-${options.taskType}`,
      type: 'agent',
      name: `Delegate ${options.taskType} task`,
      function: async (state: WorkflowState) => {
        return {
          context: {
            ...state.context,
            delegation: {
              taskType: options.taskType,
              requiredCapabilities: options.requiredCapabilities,
              maxAgents: options.maxAgents || 1,
              parallel: options.parallel || false,
              task: state.context?.currentTask,
              timestamp: new Date()
            }
          }
        };
      },
      metadata: {
        delegation: true,
        taskType: options.taskType,
        requiredCapabilities: options.requiredCapabilities,
        parallel: options.parallel || false
      }
    };
  }
  
  /**
   * Create a node that aggregates responses from multiple agents
   */
  static createAggregationNode(agentIds: string[], options?: {
    aggregationType?: 'all' | 'first' | 'majority' | 'custom';
    customAggregator?: (responses: any[]) => any;
    timeout?: number;
  }): WorkflowNode {
    return {
      id: 'a2a-aggregate',
      type: 'agent',
      name: 'Aggregate agent responses',
      function: async (state: WorkflowState) => {
        const responses = agentIds.map(id => 
          state.context?.[`agent_${id}_response`]
        ).filter(Boolean);
        
        let aggregatedResult: any;
        
        switch (options?.aggregationType || 'all') {
          case 'all':
            aggregatedResult = responses;
            break;
          case 'first':
            aggregatedResult = responses[0];
            break;
          case 'majority':
            // Simple majority logic (could be enhanced)
            aggregatedResult = responses[Math.floor(responses.length / 2)];
            break;
          case 'custom':
            if (options?.customAggregator) {
              aggregatedResult = options.customAggregator(responses);
            } else {
              aggregatedResult = responses;
            }
            break;
        }
        
        return {
          context: {
            ...state.context,
            aggregatedResponse: aggregatedResult,
            aggregationMetadata: {
              totalResponses: responses.length,
              agentIds,
              type: options?.aggregationType || 'all',
              timestamp: new Date()
            }
          }
        };
      },
      timeout: options?.timeout,
      metadata: {
        aggregation: true,
        agentIds,
        aggregationType: options?.aggregationType || 'all'
      }
    };
  }
  
  /**
   * Create a node that performs agent negotiation
   */
  static createNegotiationNode(options: {
    topic: string;
    participants: string[];
    maxRounds?: number;
    consensusThreshold?: number;
  }): WorkflowNode {
    return {
      id: `a2a-negotiate-${options.topic}`,
      type: 'agent',
      name: `Negotiate ${options.topic}`,
      function: async (state: WorkflowState) => {
        const currentRound = state.context?.negotiationRound || 0;
        
        return {
          context: {
            ...state.context,
            negotiation: {
              topic: options.topic,
              participants: options.participants,
              currentRound: currentRound + 1,
              maxRounds: options.maxRounds || 5,
              consensusThreshold: options.consensusThreshold || 0.75,
              proposals: state.context?.proposals || [],
              timestamp: new Date()
            }
          }
        };
      },
      metadata: {
        negotiation: true,
        topic: options.topic,
        participants: options.participants
      }
    };
  }
  
  /**
   * Create a node that handles agent authentication
   */
  static createAuthenticationNode(agentId: string, options?: {
    authMethod?: 'api-key' | 'oauth2' | 'mtls' | 'custom';
    credentials?: any;
  }): WorkflowNode {
    return {
      id: `a2a-auth-${agentId}`,
      type: 'agent',
      name: `Authenticate with ${agentId}`,
      function: async (state: WorkflowState) => {
        return {
          context: {
            ...state.context,
            authentication: {
              agentId,
              method: options?.authMethod || 'api-key',
              authenticated: false, // Will be set by adapter
              timestamp: new Date()
            }
          }
        };
      },
      metadata: {
        authentication: true,
        agentId,
        authMethod: options?.authMethod || 'api-key'
      }
    };
  }
  
  /**
   * Create a node that monitors agent health
   */
  static createHealthCheckNode(agentIds: string[]): WorkflowNode {
    return {
      id: 'a2a-health-check',
      type: 'agent',
      name: 'Check agent health',
      function: async (state: WorkflowState) => {
        return {
          context: {
            ...state.context,
            healthCheck: {
              agentIds,
              timestamp: new Date(),
              results: {} // Will be populated by adapter
            }
          }
        };
      },
      metadata: {
        healthCheck: true,
        agentIds
      }
    };
  }
  
  /**
   * Create a node that performs load balancing across agents
   */
  static createLoadBalancerNode(options: {
    agentPool: string[];
    strategy?: 'round-robin' | 'least-loaded' | 'random' | 'weighted';
    weights?: Record<string, number>;
  }): WorkflowNode {
    return {
      id: 'a2a-load-balancer',
      type: 'agent',
      name: 'Load balance across agents',
      function: async (state: WorkflowState) => {
        const lastUsedIndex = state.context?.lastUsedAgentIndex || -1;
        let selectedAgent: string;
        
        switch (options.strategy || 'round-robin') {
          case 'round-robin':
            const nextIndex = (lastUsedIndex + 1) % options.agentPool.length;
            selectedAgent = options.agentPool[nextIndex];
            break;
          case 'random':
            selectedAgent = options.agentPool[
              Math.floor(Math.random() * options.agentPool.length)
            ];
            break;
          case 'weighted':
            // Simple weighted selection (could be enhanced)
            selectedAgent = options.agentPool[0];
            break;
          case 'least-loaded':
          default:
            // Would need load information from adapter
            selectedAgent = options.agentPool[0];
        }
        
        return {
          context: {
            ...state.context,
            selectedAgent,
            lastUsedAgentIndex: options.agentPool.indexOf(selectedAgent),
            loadBalancing: {
              strategy: options.strategy || 'round-robin',
              agentPool: options.agentPool,
              timestamp: new Date()
            }
          }
        };
      },
      metadata: {
        loadBalancing: true,
        agentPool: options.agentPool,
        strategy: options.strategy || 'round-robin'
      }
    };
  }
}