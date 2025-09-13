import { WorkflowDefinition, WorkflowNode, WorkflowEdge } from '../types';
import { A2ANode, MCPNode } from '../nodes';

/**
 * Template: Data Pipeline Workflow
 * Read data → Process with agent → Save results → Notify stakeholders
 */
export function createDataPipelineWorkflow(config: {
  dataSource: string;
  processorAgent: string;
  outputPath: string;
  notifyAgents?: string[];
  transformations?: Array<{ type: string; config: any }>;
}): WorkflowDefinition {
  const nodes = [];
  const edges = [];
  
  // 1. Read data source
  const readNode = MCPNode.createToolNode('filesystem:read_file', {
    path: config.dataSource,
    encoding: 'utf-8'
  }, {
    fallbackValue: null,
    skipOnCircuitOpen: false
  });
  nodes.push(readNode);
  
  // 2. Apply transformations if specified
  let previousNodeId = readNode.id;
  if (config.transformations && config.transformations.length > 0) {
    config.transformations.forEach((transform, index) => {
      const transformNode = MCPNode.createTransformNode({
        transformer: transform.type,
        config: transform.config,
        inputPath: 'data',
        outputPath: 'transformedData'
      });
      nodes.push(transformNode);
      edges.push({ from: previousNodeId, to: transformNode.id });
      previousNodeId = transformNode.id;
    });
  }
  
  // 3. Process with agent
  const processNode = A2ANode.createSendMessageNode(config.processorAgent, {
    messageType: 'TASK_REQUEST',
    task: 'process-data',
    timeout: 30000
  });
  nodes.push(processNode);
  edges.push({ from: previousNodeId, to: processNode.id });
  
  // 4. Save results
  const saveNode = MCPNode.createToolNode('filesystem:write_file', {
    path: config.outputPath,
    contentFromState: 'context.processedData',
    createDirectories: true
  }, {
    fallbackValue: { error: 'Processing failed' },
    skipOnCircuitOpen: true
  });
  nodes.push(saveNode);
  edges.push({ from: processNode.id, to: saveNode.id });
  
  // 5. Notify stakeholders if specified
  if (config.notifyAgents && config.notifyAgents.length > 0) {
    const notifyNode = A2ANode.createBroadcastNode({
      messageType: 'NOTIFICATION',
      filterByCapability: undefined,
      waitForResponses: false
    });
    nodes.push(notifyNode);
    edges.push({ from: saveNode.id, to: notifyNode.id });
  }
  
  return {
    id: `data-pipeline-${Date.now()}`,
    name: 'Data Pipeline Workflow',
    description: `Process data from ${config.dataSource} through ${config.processorAgent}`,
    stateSchema: {
      data: { value: null },
      transformedData: { value: null },
      processedData: { value: null },
      notifications: { value: [] }
    },
    nodes,
    edges,
    entryPoint: readNode.id,
    config: {
      timeout: 300000, // 5 minutes
      maxRetries: 2,
      checkpointInterval: 30000
    }
  };
}

/**
 * Template: Multi-Agent Research Workflow
 * Search → Analyze with multiple agents → Aggregate → Generate report
 */
export function createResearchWorkflow(config: {
  topic: string;
  researchAgents: string[];
  reportFormat?: 'json' | 'markdown' | 'html';
  saveReport?: boolean;
  requireConsensus?: boolean;
}): WorkflowDefinition {
  const nodes = [];
  const edges = [];
  
  // 1. Web search for topic
  const searchNode = MCPNode.createWebSearchNode({
    query: config.topic,
    maxResults: 20
  });
  nodes.push(searchNode);
  
  // 2. Distribute to research agents
  const delegateNode = A2ANode.createDelegationNode({
    taskType: 'research-analysis',
    requiredCapabilities: ['analysis'],
    maxAgents: config.researchAgents.length,
    parallel: true
  });
  nodes.push(delegateNode);
  edges.push({ from: searchNode.id, to: delegateNode.id });
  
  // 3. Optional: Negotiate consensus
  if (config.requireConsensus) {
    const negotiateNode = A2ANode.createNegotiationNode({
      topic: 'research-findings',
      participants: config.researchAgents,
      maxRounds: 3,
      consensusThreshold: 0.7
    });
    nodes.push(negotiateNode);
    edges.push({ from: delegateNode.id, to: negotiateNode.id });
  }
  
  // 4. Aggregate results
  const aggregateNode = A2ANode.createAggregationNode(
    config.researchAgents,
    { 
      aggregationType: config.requireConsensus ? 'majority' : 'all',
      timeout: 60000
    }
  );
  nodes.push(aggregateNode);
  edges.push({ 
    from: config.requireConsensus ? 'a2a-negotiate-research-findings' : delegateNode.id, 
    to: aggregateNode.id 
  });
  
  // 5. Generate report
  const reportNode = {
    id: 'generate-report',
    type: 'llm' as const,
    name: 'Generate Research Report',
    function: async (state: any) => ({
      ...state,
      report: {
        topic: config.topic,
        findings: state.context?.aggregatedResponse,
        format: config.reportFormat || 'markdown',
        generatedAt: new Date()
      }
    })
  };
  nodes.push(reportNode);
  edges.push({ from: aggregateNode.id, to: reportNode.id });
  
  // 6. Optional: Save report
  if (config.saveReport) {
    const extension = config.reportFormat === 'markdown' ? 'md' : config.reportFormat || 'json';
    const saveNode = MCPNode.createFileWriteNode(
      `/reports/research-${Date.now()}.${extension}`,
      {
        contentFromState: 'report',
        createDirectories: true
      }
    );
    nodes.push(saveNode);
    edges.push({ from: reportNode.id, to: saveNode.id });
  }
  
  return {
    id: `research-${Date.now()}`,
    name: 'Multi-Agent Research Workflow',
    description: `Research "${config.topic}" using ${config.researchAgents.length} agents`,
    stateSchema: {
      searchResults: { value: null },
      agentFindings: { value: {} },
      consensus: { value: false },
      report: { value: null }
    },
    nodes,
    edges,
    entryPoint: searchNode.id,
    config: {
      timeout: 600000, // 10 minutes
      maxRetries: 1,
      checkpointInterval: 60000
    }
  };
}

/**
 * Template: Tool Chain Workflow
 * Execute a sequence of tools with error handling
 */
export function createToolChainWorkflow(config: {
  tools: Array<{
    name: string;
    args: any;
    skipOnFailure?: boolean;
    fallbackValue?: any;
  }>;
  parallel?: boolean;
}): WorkflowDefinition {
  const nodes: WorkflowNode[] = [];
  const edges: WorkflowEdge[] = [];
  
  if (config.parallel) {
    // Create parallel tools node
    const parallelNode = MCPNode.createParallelToolsNode(
      config.tools.map((tool, index) => ({
        tool: tool.name,
        args: tool.args,
        id: `tool-${index}`
      }))
    );
    nodes.push(parallelNode);
  } else {
    // Create sequential tool chain
    let previousNodeId: string | null = null;
    
    config.tools.forEach((tool, index) => {
      const toolNode = MCPNode.createToolNode(tool.name, tool.args, {
        fallbackValue: tool.fallbackValue,
        skipOnCircuitOpen: tool.skipOnFailure,
        retryOnFailure: true
      });
      nodes.push(toolNode);
      
      if (previousNodeId) {
        edges.push({ from: previousNodeId, to: toolNode.id });
      }
      previousNodeId = toolNode.id;
    });
  }
  
  return {
    id: `tool-chain-${Date.now()}`,
    name: 'Tool Chain Workflow',
    description: `Execute ${config.tools.length} tools ${config.parallel ? 'in parallel' : 'sequentially'}`,
    stateSchema: {
      toolResults: { value: {} }
    },
    nodes,
    edges,
    entryPoint: nodes[0].id,
    config: {
      timeout: 120000, // 2 minutes
      maxRetries: 2
    }
  };
}

/**
 * Template: Agent Collaboration Workflow
 * Coordinate multiple agents to solve a complex task
 */
export function createCollaborationWorkflow(config: {
  task: string;
  coordinatorAgent: string;
  workerAgents: string[];
  requireApproval?: boolean;
  maxIterations?: number;
}): WorkflowDefinition {
  const nodes = [];
  const edges = [];
  
  // 1. Task decomposition by coordinator
  const decomposeNode = A2ANode.createSendMessageNode(config.coordinatorAgent, {
    messageType: 'TASK_REQUEST',
    task: 'decompose-task',
    timeout: 30000
  });
  nodes.push(decomposeNode);
  
  // 2. Load balance across workers
  const loadBalanceNode = A2ANode.createLoadBalancerNode({
    agentPool: config.workerAgents,
    strategy: 'least-loaded'
  });
  nodes.push(loadBalanceNode);
  edges.push({ from: decomposeNode.id, to: loadBalanceNode.id });
  
  // 3. Delegate subtasks
  const delegateNode = A2ANode.createDelegationNode({
    taskType: 'subtask-execution',
    requiredCapabilities: [],
    maxAgents: config.workerAgents.length,
    parallel: true
  });
  nodes.push(delegateNode);
  edges.push({ from: loadBalanceNode.id, to: delegateNode.id });
  
  // 4. Aggregate worker results
  const aggregateNode = A2ANode.createAggregationNode(
    config.workerAgents,
    { aggregationType: 'all' }
  );
  nodes.push(aggregateNode);
  edges.push({ from: delegateNode.id, to: aggregateNode.id });
  
  // 5. Coordinator review
  const reviewNode = A2ANode.createSendMessageNode(config.coordinatorAgent, {
    messageType: 'REVIEW_REQUEST',
    task: 'review-results'
  });
  nodes.push(reviewNode);
  edges.push({ from: aggregateNode.id, to: reviewNode.id });
  
  // 6. Optional: Human approval
  if (config.requireApproval) {
    const approvalNode = {
      id: 'human-approval',
      type: 'human' as const,
      name: 'Human Approval',
      function: async (state: any) => ({
        ...state,
        approved: true // Will be set by human input
      }),
      timeout: 3600000 // 1 hour timeout for human input
    };
    nodes.push(approvalNode);
    edges.push({ from: reviewNode.id, to: approvalNode.id });
  }
  
  return {
    id: `collaboration-${Date.now()}`,
    name: 'Agent Collaboration Workflow',
    description: `Coordinate ${config.workerAgents.length} agents for: ${config.task}`,
    stateSchema: {
      task: { value: config.task },
      subtasks: { value: [] },
      workerResults: { value: {} },
      coordinatorReview: { value: null },
      approved: { value: false },
      iterations: { value: 0, default: 0 }
    },
    nodes,
    edges,
    entryPoint: decomposeNode.id,
    conditionalRouting: config.maxIterations ? [
      {
        source: reviewNode.id,
        conditions: [
          {
            condition: (state) => !state.coordinatorReview?.complete && 
                                  state.iterations < (config.maxIterations || 3),
            target: decomposeNode.id
          }
        ],
        default: config.requireApproval ? 'human-approval' : reviewNode.id
      }
    ] : undefined,
    config: {
      timeout: 1800000, // 30 minutes
      maxRetries: 1,
      checkpointInterval: 60000
    }
  };
}

/**
 * Template: ETL Workflow
 * Extract → Transform → Load with monitoring
 */
export function createETLWorkflow(config: {
  sources: string[];
  transformations: Array<{ type: string; config: any }>;
  destination: string;
  validationRules?: Array<(data: any) => boolean>;
  notifyOnComplete?: string[];
}): WorkflowDefinition {
  const nodes = [];
  const edges = [];
  
  // 1. Extract from multiple sources in parallel
  const extractNode = MCPNode.createParallelToolsNode(
    config.sources.map((source, index) => ({
      tool: 'filesystem:read_file',
      args: { path: source },
      id: `extract-${index}`
    }))
  );
  nodes.push(extractNode);
  
  // 2. Validate data if rules provided
  if (config.validationRules && config.validationRules.length > 0) {
    const validateNode = {
      id: 'validate-data',
      type: 'custom' as const,
      name: 'Validate Data',
      function: async (state: any) => {
        const data = state.context?.extractedData;
        const validationResults = config.validationRules!.map(rule => rule(data));
        const isValid = validationResults.every(result => result === true);
        
        return {
          ...state,
          context: {
            ...state.context,
            dataValid: isValid,
            validationErrors: validationResults
              .map((result, index) => result ? null : `Rule ${index} failed`)
              .filter(Boolean)
          }
        };
      }
    };
    nodes.push(validateNode);
    edges.push({ from: extractNode.id, to: validateNode.id });
  }
  
  // 3. Transform data
  const transformChain = MCPNode.createToolChainNode(
    config.transformations.map(t => ({
      tool: 'transform:' + t.type,
      args: t.config
    }))
  );
  nodes.push(transformChain);
  edges.push({ 
    from: config.validationRules ? 'validate-data' : extractNode.id, 
    to: transformChain.id 
  });
  
  // 4. Load to destination
  const loadNode = MCPNode.createFileWriteNode(config.destination, {
    contentFromState: 'context.transformedData',
    createDirectories: true
  });
  nodes.push(loadNode);
  edges.push({ from: transformChain.id, to: loadNode.id });
  
  // 5. Notify on completion
  if (config.notifyOnComplete && config.notifyOnComplete.length > 0) {
    const notifyNode = A2ANode.createBroadcastNode({
      messageType: 'ETL_COMPLETE',
      waitForResponses: false
    });
    nodes.push(notifyNode);
    edges.push({ from: loadNode.id, to: notifyNode.id });
  }
  
  return {
    id: `etl-${Date.now()}`,
    name: 'ETL Workflow',
    description: `ETL from ${config.sources.length} sources to ${config.destination}`,
    stateSchema: {
      extractedData: { value: null },
      dataValid: { value: true },
      transformedData: { value: null },
      loadResult: { value: null }
    },
    nodes,
    edges,
    entryPoint: extractNode.id,
    conditionalRouting: config.validationRules ? [
      {
        source: 'validate-data',
        conditions: [
          {
            condition: (state) => state.context?.dataValid === true,
            target: transformChain.id
          }
        ],
        default: 'validate-data' // Stay at validation if failed
      }
    ] : undefined,
    config: {
      timeout: 600000, // 10 minutes
      maxRetries: 2,
      checkpointInterval: 30000
    }
  };
}