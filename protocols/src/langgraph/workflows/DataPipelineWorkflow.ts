import { WorkflowDefinition } from '../types';
import { MCPNode, A2ANode } from '../nodes';

/**
 * Data Processing Pipeline Workflow
 * Reads data from a source, processes it, and distributes to agents
 */
export const DataPipelineWorkflow: WorkflowDefinition = {
  id: 'data-pipeline',
  name: 'Data Processing Pipeline',
  description: 'Read, process, transform, and share data across agents',
  stateSchema: {
    messages: { value: [], default: [] },
    sourceData: { value: null },
    processedData: { value: null },
    transformedData: { value: null },
    validationResult: { value: null },
    sharedWith: { value: [], default: [] },
    errors: { value: [], default: [] }
  },
  nodes: [
    // Read source data
    MCPNode.createFileReadNode('/data/input.json', {
      parseAs: 'json'
    }),
    
    // Validate data structure
    {
      id: 'validate-data',
      type: 'custom',
      name: 'Validate Data Structure',
      function: async (state) => {
        const data = state.context?.['mcp-filesystem-read-file_result'];
        const isValid = data && typeof data === 'object';
        
        return {
          validationResult: {
            isValid,
            errors: isValid ? [] : ['Invalid data structure'],
            timestamp: new Date()
          }
        };
      }
    },
    
    // Process data
    {
      id: 'process-data',
      type: 'custom',
      name: 'Process Data',
      function: async (state) => {
        const data = state.context?.['mcp-filesystem-read-file_result'];
        
        // Example processing: extract and enrich
        const processed = {
          ...data,
          processedAt: new Date(),
          metadata: {
            recordCount: Array.isArray(data) ? data.length : 1,
            version: '1.0'
          }
        };
        
        return {
          processedData: processed
        };
      }
    },
    
    // Transform data
    MCPNode.createTransformNode({
      transformer: 'json-to-csv',
      inputPath: 'processedData',
      outputPath: 'transformedData'
    }),
    
    // Save processed data
    MCPNode.createFileWriteNode('/data/output.json', {
      contentFromState: 'processedData',
      createDirectories: true
    }),
    
    // Discover available agents
    A2ANode.createDiscoveryNode({
      capability: 'data-processing',
      maxAgents: 5
    }),
    
    // Broadcast to agents
    A2ANode.createBroadcastNode({
      messageType: 'DATA_AVAILABLE',
      filterByCapability: 'data-processing',
      waitForResponses: true,
      timeout: 30000
    }),
    
    // Aggregate responses
    {
      id: 'aggregate-responses',
      type: 'custom',
      name: 'Aggregate Agent Responses',
      function: async (state) => {
        const responses = state.context?.broadcast?.responses || [];
        
        return {
          sharedWith: responses.map((r: any) => r.agentId),
          context: {
            ...state.context,
            aggregatedResponses: responses,
            successCount: responses.filter((r: any) => r.success).length
          }
        };
      }
    }
  ],
  edges: [
    { from: 'mcp-filesystem-read-file', to: 'validate-data' },
    { 
      from: 'validate-data', 
      to: 'process-data',
      condition: (state) => state.validationResult?.isValid === true
    },
    { from: 'process-data', to: 'mcp-transform-json-to-csv' },
    { from: 'mcp-transform-json-to-csv', to: 'mcp-write--data-output-json' },
    { from: 'mcp-write--data-output-json', to: 'a2a-discovery' },
    { from: 'a2a-discovery', to: 'a2a-broadcast' },
    { from: 'a2a-broadcast', to: 'aggregate-responses' }
  ],
  entryPoint: 'mcp-filesystem-read-file',
  conditionalRouting: [
    {
      source: 'validate-data',
      conditions: [
        {
          condition: (state) => state.validationResult?.isValid === true,
          target: 'process-data'
        },
        {
          condition: (state) => state.validationResult?.isValid === false,
          target: 'error-handler'
        }
      ],
      default: 'process-data'
    }
  ],
  config: {
    maxRetries: 3,
    timeout: 120000, // 2 minutes
    checkpointInterval: 5000
  }
};

/**
 * Create a custom data pipeline with specific configuration
 */
export function createCustomDataPipeline(options: {
  inputPath: string;
  outputPath: string;
  transformer?: string;
  agentCapability?: string;
  validation?: (data: any) => boolean;
}): WorkflowDefinition {
  const workflow: WorkflowDefinition = {
    ...DataPipelineWorkflow,
    id: `data-pipeline-${Date.now()}`,
    nodes: [
      MCPNode.createFileReadNode(options.inputPath),
      {
        id: 'custom-validation',
        type: 'custom',
        name: 'Custom Validation',
        function: async (state) => {
          const data = state.context?.['mcp-filesystem-read-file_result'];
          const isValid = options.validation ? options.validation(data) : true;
          
          return {
            validationResult: { isValid }
          };
        }
      },
      ...DataPipelineWorkflow.nodes.slice(2) // Keep the rest of the nodes
    ]
  };
  
  // Update node configurations
  if (options.outputPath) {
    const writeNode = workflow.nodes.find(n => n.id.includes('write'));
    if (writeNode) {
      writeNode.metadata = { ...writeNode.metadata, path: options.outputPath };
    }
  }
  
  if (options.agentCapability) {
    const discoveryNode = workflow.nodes.find(n => n.id === 'a2a-discovery');
    if (discoveryNode) {
      discoveryNode.metadata = { ...discoveryNode.metadata, capability: options.agentCapability };
    }
  }
  
  return workflow;
}