import { WorkflowDefinition } from '../types';
import { MCPNode, A2ANode } from '../nodes';

/**
 * Research Workflow
 * Performs web research, analyzes results, generates reports with human review
 */
export const ResearchWorkflow: WorkflowDefinition = {
  id: 'research',
  name: 'Research Workflow',
  description: 'Search, analyze, report, and review research findings',
  stateSchema: {
    query: { value: '' },
    searchResults: { value: [], default: [] },
    additionalSources: { value: [], default: [] },
    analysis: { value: null },
    report: { value: null },
    approved: { value: false },
    needsRevision: { value: false },
    revisionNotes: { value: '' },
    finalReport: { value: null }
  },
  nodes: [
    // Initial web search
    MCPNode.createWebSearchNode({
      queryFromState: 'query',
      maxResults: 20
    }),
    
    // Fetch detailed content from top results
    {
      id: 'fetch-details',
      type: 'custom',
      name: 'Fetch Detailed Content',
      function: async (state) => {
        const results = state.context?.['mcp-web-search_result'] || [];
        const topUrls = results.slice(0, 5).map((r: any) => r.url);
        
        return {
          context: {
            ...state.context,
            urlsToFetch: topUrls
          }
        };
      }
    },
    
    // Send to analyst agent
    A2ANode.createSendMessageNode('analyst-001', {
      messageType: 'ANALYSIS_REQUEST',
      task: 'analyze-research-data',
      timeout: 60000
    }),
    
    // Wait for analysis
    A2ANode.createWaitForResponseNode('analyst-001', {
      timeout: 60000,
      retryOnTimeout: true
    }),
    
    // Generate report using LLM
    {
      id: 'generate-report',
      type: 'llm',
      name: 'Generate Report',
      function: async (state) => {
        const analysis = state.context?.['a2a-wait-analyst-001_result'];
        const searchResults = state.searchResults;
        
        const report = {
          title: `Research Report: ${state.query}`,
          executiveSummary: 'Generated executive summary...',
          findings: analysis?.findings || [],
          sources: searchResults,
          recommendations: analysis?.recommendations || [],
          generatedAt: new Date()
        };
        
        return {
          report
        };
      }
    },
    
    // Human review
    {
      id: 'human-review',
      type: 'human',
      name: 'Human Review',
      function: async (state) => {
        // This will trigger human input request
        return {
          context: {
            ...state.context,
            awaitingReview: true,
            reviewStarted: new Date()
          }
        };
      },
      metadata: {
        prompt: 'Please review the research report and provide approval or revision notes',
        options: ['Approve', 'Request Revision', 'Reject']
      }
    },
    
    // Process review decision
    {
      id: 'process-review',
      type: 'custom',
      name: 'Process Review Decision',
      function: async (state) => {
        const decision = state.context?.['human-review_human_input'];
        
        return {
          approved: decision === 'Approve',
          needsRevision: decision === 'Request Revision',
          revisionNotes: state.context?.revisionNotes || ''
        };
      }
    },
    
    // Revise report if needed
    {
      id: 'revise-report',
      type: 'llm',
      name: 'Revise Report',
      function: async (state) => {
        const originalReport = state.report;
        const revisionNotes = state.revisionNotes;
        
        // Apply revisions
        const revisedReport = {
          ...originalReport,
          revised: true,
          revisionNotes,
          revisedAt: new Date()
        };
        
        return {
          report: revisedReport
        };
      }
    },
    
    // Publish report
    {
      id: 'publish',
      type: 'custom',
      name: 'Publish Report',
      function: async (state) => {
        return {
          finalReport: state.report,
          context: {
            ...state.context,
            published: true,
            publishedAt: new Date()
          }
        };
      }
    },
    
    // Save report to file
    MCPNode.createFileWriteNode('/reports/research-report.json', {
      contentFromState: 'finalReport',
      createDirectories: true
    }),
    
    // Notify stakeholders
    A2ANode.createBroadcastNode({
      messageType: 'REPORT_PUBLISHED',
      filterByCapability: 'report-consumer'
    })
  ],
  edges: [
    { from: 'mcp-web-search', to: 'fetch-details' },
    { from: 'fetch-details', to: 'a2a-send-analyst-001' },
    { from: 'a2a-send-analyst-001', to: 'a2a-wait-analyst-001' },
    { from: 'a2a-wait-analyst-001', to: 'generate-report' },
    { from: 'generate-report', to: 'human-review' },
    { from: 'human-review', to: 'process-review' }
  ],
  entryPoint: 'mcp-web-search',
  conditionalRouting: [
    {
      source: 'process-review',
      conditions: [
        {
          condition: (state) => state.approved === true,
          target: 'publish'
        },
        {
          condition: (state) => state.needsRevision === true,
          target: 'revise-report'
        }
      ],
      default: 'generate-report' // Regenerate if rejected
    },
    {
      source: 'revise-report',
      conditions: [
        {
          condition: (state) => true, // Always go back to review after revision
          target: 'human-review'
        }
      ],
      default: 'human-review'
    },
    {
      source: 'publish',
      conditions: [
        {
          condition: (state) => true,
          target: 'mcp-write--reports-research-report-json'
        }
      ],
      default: 'mcp-write--reports-research-report-json'
    },
    {
      source: 'mcp-write--reports-research-report-json',
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
    timeout: 300000, // 5 minutes
    checkpointInterval: 10000
  }
};

/**
 * Create a custom research workflow
 */
export function createCustomResearchWorkflow(options: {
  query: string;
  analystAgents?: string[];
  maxSearchResults?: number;
  requireApproval?: boolean;
  outputPath?: string;
}): WorkflowDefinition {
  const workflow: WorkflowDefinition = {
    ...ResearchWorkflow,
    id: `research-${Date.now()}`,
    stateSchema: {
      ...ResearchWorkflow.stateSchema,
      query: { value: options.query }
    }
  };
  
  // Customize search node
  if (options.maxSearchResults) {
    const searchNode = workflow.nodes.find(n => n.id === 'mcp-web-search');
    if (searchNode) {
      searchNode.metadata = { 
        ...searchNode.metadata, 
        maxResults: options.maxSearchResults 
      };
    }
  }
  
  // Add multiple analyst agents if specified
  if (options.analystAgents && options.analystAgents.length > 1) {
    // Replace single analyst with parallel analysis
    const analyzeIndex = workflow.nodes.findIndex(n => n.id === 'a2a-send-analyst-001');
    if (analyzeIndex !== -1) {
      // Remove old analyst nodes
      workflow.nodes.splice(analyzeIndex, 2);
      
      // Add parallel analyst nodes
      const analystNodes = options.analystAgents.map(agentId => 
        A2ANode.createSendMessageNode(agentId, {
          messageType: 'ANALYSIS_REQUEST',
          task: 'analyze-research-data'
        })
      );
      
      // Add aggregation node
      const aggregationNode = A2ANode.createAggregationNode(
        options.analystAgents,
        { aggregationType: 'all' }
      );
      
      workflow.nodes.splice(analyzeIndex, 0, ...analystNodes, aggregationNode);
    }
  }
  
  // Skip approval if not required
  if (!options.requireApproval) {
    // Remove human review nodes
    workflow.nodes = workflow.nodes.filter(n => 
      !['human-review', 'process-review', 'revise-report'].includes(n.id)
    );
    
    // Update routing
    workflow.edges = workflow.edges.map(edge => {
      if (edge.from === 'generate-report') {
        return { ...edge, to: 'publish' };
      }
      return edge;
    });
  }
  
  // Custom output path
  if (options.outputPath) {
    const writeNode = workflow.nodes.find(n => n.id.includes('write'));
    if (writeNode) {
      writeNode.metadata = { ...writeNode.metadata, path: options.outputPath };
    }
  }
  
  return workflow;
}