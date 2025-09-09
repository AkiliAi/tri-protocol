import { WorkflowDefinition } from '../types';
import { A2ANode, MCPNode } from '../nodes';

/**
 * Multi-Agent Collaboration Workflow
 * Coordinates multiple agents working together on complex tasks
 */
export const MultiAgentCollaborationWorkflow: WorkflowDefinition = {
  id: 'multi-agent-collaboration',
  name: 'Multi-Agent Collaboration',
  description: 'Coordinate multiple agents to accomplish complex tasks through collaboration',
  stateSchema: {
    task: { value: null },
    taskDecomposition: { value: [], default: [] },
    agentAssignments: { value: {}, default: {} },
    agentResults: { value: {}, default: {} },
    negotiationRounds: { value: 0, default: 0 },
    consensus: { value: false, default: false },
    finalResult: { value: null },
    collaborationMetrics: { value: null }
  },
  nodes: [
    // Discover available agents
    A2ANode.createDiscoveryNode({
      maxAgents: 10
    }),
    
    // Decompose task into subtasks
    {
      id: 'decompose-task',
      type: 'llm',
      name: 'Decompose Task',
      function: async (state) => {
        const task = state.task;
        
        // Decompose into subtasks (simplified)
        const subtasks = [
          { id: 'subtask-1', type: 'research', description: 'Research phase' },
          { id: 'subtask-2', type: 'analysis', description: 'Analysis phase' },
          { id: 'subtask-3', type: 'synthesis', description: 'Synthesis phase' }
        ];
        
        return {
          taskDecomposition: subtasks
        };
      }
    },
    
    // Assign agents to subtasks
    {
      id: 'assign-agents',
      type: 'custom',
      name: 'Assign Agents to Subtasks',
      function: async (state) => {
        const availableAgents = (state.context?.discoveryResult?.agents as string[]) || [];
        const subtasks = state.taskDecomposition;
        
        const assignments: Record<string, string[]> = {};
        
        // Simple round-robin assignment
        subtasks.forEach((subtask: any, index: number) => {
          if (availableAgents.length > 0) {
            const agentIndex = index % availableAgents.length;
            assignments[subtask.id] = [availableAgents[agentIndex]];
          }
        });
        
        return {
          agentAssignments: assignments
        };
      }
    },
    
    // Create load balancer for agent distribution
    A2ANode.createLoadBalancerNode({
      agentPool: [], // Will be populated from discovery
      strategy: 'round-robin'
    }),
    
    // Delegate subtasks to agents
    A2ANode.createDelegationNode({
      taskType: 'collaborative-task',
      requiredCapabilities: ['problem-solving'],
      maxAgents: 5,
      parallel: true
    }),
    
    // Monitor agent progress
    {
      id: 'monitor-progress',
      type: 'custom',
      name: 'Monitor Agent Progress',
      function: async (state) => {
        const startTime = state.context?.delegationStartTime || Date.now();
        const elapsedTime = Date.now() - startTime;
        
        return {
          context: {
            ...state.context,
            progressCheck: {
              elapsedTime,
              checkTime: new Date()
            }
          }
        };
      }
    },
    
    // Collect results from agents
    {
      id: 'collect-results',
      type: 'custom',
      name: 'Collect Agent Results',
      function: async (state) => {
        const assignments = state.agentAssignments;
        const results: Record<string, any> = {};
        
        // Collect results from each agent
        for (const [subtaskId, agents] of Object.entries(assignments)) {
          const agentList = agents as string[];
          if (agentList.length > 0) {
            results[subtaskId] = state.context?.[`agent_${agentList[0]}_result`];
          }
        }
        
        return {
          agentResults: results
        };
      }
    },
    
    // Negotiate consensus among agents
    A2ANode.createNegotiationNode({
      topic: 'solution-consensus',
      participants: [], // Will be populated
      maxRounds: 3,
      consensusThreshold: 0.75
    }),
    
    // Check consensus
    {
      id: 'check-consensus',
      type: 'custom',
      name: 'Check Consensus',
      function: async (state) => {
        const negotiation = state.context?.negotiation;
        const currentRound = negotiation?.currentRound || 0;
        
        // Simple consensus check
        const hasConsensus = currentRound >= 2; // After 2 rounds
        
        return {
          consensus: hasConsensus,
          negotiationRounds: currentRound
        };
      }
    },
    
    // Aggregate final results
    {
      id: 'aggregate-results',
      type: 'custom',
      name: 'Aggregate Final Results',
      function: async (state) => {
        const agentResults = state.agentResults;
        
        // Combine all results
        const finalResult = {
          subtaskResults: agentResults,
          consensus: state.consensus,
          negotiationRounds: state.negotiationRounds,
          completedAt: new Date()
        };
        
        return {
          finalResult
        };
      }
    },
    
    // Calculate collaboration metrics
    {
      id: 'calculate-metrics',
      type: 'custom',
      name: 'Calculate Collaboration Metrics',
      function: async (state) => {
        const startTime = state.context?.workflowStartTime || Date.now();
        const endTime = Date.now();
        
        const metrics = {
          totalAgents: Object.keys(state.agentAssignments).length,
          subtasksCompleted: Object.keys(state.agentResults).length,
          negotiationRounds: state.negotiationRounds,
          consensusAchieved: state.consensus,
          totalDuration: endTime - startTime,
          efficiency: Object.keys(state.agentResults).length / 
                     Object.keys(state.agentAssignments).length
        };
        
        return {
          collaborationMetrics: metrics
        };
      }
    },
    
    // Save collaboration report
    MCPNode.createFileWriteNode('/reports/collaboration-report.json', {
      contentFromState: 'finalResult',
      createDirectories: true
    }),
    
    // Notify all participating agents
    A2ANode.createBroadcastNode({
      messageType: 'COLLABORATION_COMPLETE',
      waitForResponses: false
    })
  ],
  edges: [
    { from: 'a2a-discovery', to: 'decompose-task' },
    { from: 'decompose-task', to: 'assign-agents' },
    { from: 'assign-agents', to: 'a2a-load-balancer' },
    { from: 'a2a-load-balancer', to: 'a2a-delegate-collaborative-task' },
    { from: 'a2a-delegate-collaborative-task', to: 'monitor-progress' },
    { from: 'monitor-progress', to: 'collect-results' },
    { from: 'collect-results', to: 'a2a-negotiate-solution-consensus' },
    { from: 'a2a-negotiate-solution-consensus', to: 'check-consensus' }
  ],
  entryPoint: 'a2a-discovery',
  conditionalRouting: [
    {
      source: 'check-consensus',
      conditions: [
        {
          condition: (state) => state.consensus === true,
          target: 'aggregate-results'
        },
        {
          condition: (state) => state.negotiationRounds < 3,
          target: 'a2a-negotiate-solution-consensus'
        }
      ],
      default: 'aggregate-results' // Force aggregation after max rounds
    },
    {
      source: 'aggregate-results',
      conditions: [
        {
          condition: (state) => true,
          target: 'calculate-metrics'
        }
      ],
      default: 'calculate-metrics'
    },
    {
      source: 'calculate-metrics',
      conditions: [
        {
          condition: (state) => true,
          target: 'mcp-write--reports-collaboration-report-json'
        }
      ],
      default: 'mcp-write--reports-collaboration-report-json'
    },
    {
      source: 'mcp-write--reports-collaboration-report-json',
      conditions: [
        {
          condition: (state) => true,
          target: 'a2a-broadcast'
        }
      ],
      default: 'a2a-broadcast'
    }
  ],
  config: {
    maxRetries: 2,
    timeout: 600000, // 10 minutes for complex collaboration
    checkpointInterval: 15000,
    parallelLimit: 5
  }
};

/**
 * Create a custom collaboration workflow
 */
export function createCustomCollaborationWorkflow(options: {
  task: any;
  requiredAgents?: string[];
  maxNegotiationRounds?: number;
  parallelExecution?: boolean;
  consensusThreshold?: number;
}): WorkflowDefinition {
  const workflow: WorkflowDefinition = {
    ...MultiAgentCollaborationWorkflow,
    id: `collaboration-${Date.now()}`,
    stateSchema: {
      ...MultiAgentCollaborationWorkflow.stateSchema,
      task: { value: options.task }
    }
  };
  
  // Use specific agents if provided
  if (options.requiredAgents && options.requiredAgents.length > 0) {
    // Skip discovery and use provided agents
    workflow.nodes = workflow.nodes.filter(n => n.id !== 'a2a-discovery');
    workflow.entryPoint = 'decompose-task';
    
    // Add initial state with agents
    workflow.nodes.unshift({
      id: 'setup-agents',
      type: 'custom',
      name: 'Setup Required Agents',
      function: async (state) => ({
        context: {
          ...state.context,
          discoveryResult: {
            agents: options.requiredAgents
          }
        }
      })
    });
    
    workflow.entryPoint = 'setup-agents';
    workflow.edges.unshift({ from: 'setup-agents', to: 'decompose-task' });
  }
  
  // Customize negotiation
  if (options.maxNegotiationRounds) {
    const negotiationNode = workflow.nodes.find(n => 
      n.id === 'a2a-negotiate-solution-consensus'
    );
    if (negotiationNode) {
      negotiationNode.metadata = {
        ...negotiationNode.metadata,
        maxRounds: options.maxNegotiationRounds
      };
    }
  }
  
  // Set consensus threshold
  if (options.consensusThreshold) {
    const negotiationNode = workflow.nodes.find(n => 
      n.id === 'a2a-negotiate-solution-consensus'
    );
    if (negotiationNode) {
      negotiationNode.metadata = {
        ...negotiationNode.metadata,
        consensusThreshold: options.consensusThreshold
      };
    }
  }
  
  // Configure parallel execution
  if (options.parallelExecution) {
    workflow.config = {
      ...workflow.config,
      parallelLimit: 10 // Increase parallel limit
    };
  }
  
  return workflow;
}