import {
  DataPipelineWorkflow,
  createCustomDataPipeline,
  ResearchWorkflow,
  createCustomResearchWorkflow,
  MultiAgentCollaborationWorkflow,
  createCustomCollaborationWorkflow
} from '../../../../protocols/src/langgraph/workflows';

describe('Workflow Templates', () => {
  describe('DataPipelineWorkflow', () => {
    it('should have correct structure', () => {
      expect(DataPipelineWorkflow.id).toBe('data-pipeline');
      expect(DataPipelineWorkflow.name).toBe('Data Processing Pipeline');
      expect(DataPipelineWorkflow.nodes).toHaveLength(8);
      expect(DataPipelineWorkflow.entryPoint).toBe('mcp-filesystem-read-file');
    });

    it('should have proper state schema', () => {
      expect(DataPipelineWorkflow.stateSchema).toHaveProperty('sourceData');
      expect(DataPipelineWorkflow.stateSchema).toHaveProperty('processedData');
      expect(DataPipelineWorkflow.stateSchema).toHaveProperty('transformedData');
      expect(DataPipelineWorkflow.stateSchema).toHaveProperty('validationResult');
    });

    it('should have conditional routing for validation', () => {
      expect(DataPipelineWorkflow.conditionalRouting).toBeDefined();
      expect(DataPipelineWorkflow.conditionalRouting![0].source).toBe('validate-data');
      
      const conditions = DataPipelineWorkflow.conditionalRouting![0].conditions;
      expect(conditions).toHaveLength(2);
    });

    it('should process data correctly', async () => {
      const processNode = DataPipelineWorkflow.nodes.find(n => n.id === 'process-data');
      expect(processNode).toBeDefined();
      
      const state = {
        context: {
          'mcp-filesystem-read-file_result': { data: 'test' }
        }
      };
      
      const result = await processNode!.function(state);
      expect(result.processedData).toBeDefined();
      expect(result.processedData.metadata).toHaveProperty('recordCount');
    });
  });

  describe('createCustomDataPipeline', () => {
    it('should create custom pipeline with specified options', () => {
      const customPipeline = createCustomDataPipeline({
        inputPath: '/custom/input.json',
        outputPath: '/custom/output.json',
        transformer: 'xml-to-json',
        agentCapability: 'custom-processing',
        validation: (data) => data !== null
      });

      expect(customPipeline.id).toContain('data-pipeline-');
      expect(customPipeline.nodes[0].metadata?.tool).toBe('filesystem:read_file');
      
      // Check custom validation node
      const validationNode = customPipeline.nodes.find(n => n.id === 'custom-validation');
      expect(validationNode).toBeDefined();
    });

    it('should apply custom validation function', async () => {
      const customValidation = jest.fn((data) => data.valid === true);
      
      const pipeline = createCustomDataPipeline({
        inputPath: '/test.json',
        outputPath: '/out.json',
        validation: customValidation
      });

      const validationNode = pipeline.nodes.find(n => n.id === 'custom-validation');
      
      // Test validation with valid data
      const validState = {
        context: {
          'mcp-filesystem-read-file_result': { valid: true }
        }
      };
      
      const validResult = await validationNode!.function(validState);
      expect(validResult.validationResult.isValid).toBe(true);
      expect(customValidation).toHaveBeenCalledWith({ valid: true });
    });
  });

  describe('ResearchWorkflow', () => {
    it('should have correct structure', () => {
      expect(ResearchWorkflow.id).toBe('research');
      expect(ResearchWorkflow.name).toBe('Research Workflow');
      expect(ResearchWorkflow.nodes.length).toBeGreaterThan(5);
      expect(ResearchWorkflow.entryPoint).toBe('mcp-web-search');
    });

    it('should have human review step', () => {
      const humanNode = ResearchWorkflow.nodes.find(n => n.type === 'human');
      expect(humanNode).toBeDefined();
      expect(humanNode?.metadata?.prompt).toContain('review');
    });

    it('should have conditional routing for approval', () => {
      const reviewRouting = ResearchWorkflow.conditionalRouting?.find(
        r => r.source === 'process-review'
      );
      
      expect(reviewRouting).toBeDefined();
      expect(reviewRouting?.conditions).toHaveLength(2);
      
      // Test approval condition
      const approvalCondition = reviewRouting?.conditions.find(
        c => c.target === 'publish'
      );
      expect(approvalCondition?.condition({ approved: true })).toBe(true);
    });

    it('should generate report', async () => {
      const reportNode = ResearchWorkflow.nodes.find(n => n.id === 'generate-report');
      expect(reportNode).toBeDefined();
      
      const state = {
        query: 'test query',
        searchResults: [{ url: 'http://example.com' }],
        context: {
          'a2a-wait-analyst-001_result': {
            findings: ['finding1'],
            recommendations: ['rec1']
          }
        }
      };
      
      const result = await reportNode!.function(state);
      expect(result.report).toBeDefined();
      expect(result.report.title).toContain('test query');
    });
  });

  describe('createCustomResearchWorkflow', () => {
    it('should create workflow with custom query', () => {
      const customWorkflow = createCustomResearchWorkflow({
        query: 'Custom research topic',
        maxSearchResults: 50,
        requireApproval: true,
        outputPath: '/custom/report.json'
      });

      expect(customWorkflow.stateSchema.query.value).toBe('Custom research topic');
      
      const searchNode = customWorkflow.nodes.find(n => n.id === 'mcp-web-search');
      expect(searchNode?.metadata?.maxResults).toBe(50);
    });

    it('should skip approval when not required', () => {
      const workflow = createCustomResearchWorkflow({
        query: 'Test',
        requireApproval: false
      });

      // Should not have human review nodes
      const humanNode = workflow.nodes.find(n => n.type === 'human');
      expect(humanNode).toBeUndefined();
      
      const processReviewNode = workflow.nodes.find(n => n.id === 'process-review');
      expect(processReviewNode).toBeUndefined();
    });

    it('should use multiple analyst agents', () => {
      const workflow = createCustomResearchWorkflow({
        query: 'Test',
        analystAgents: ['analyst-1', 'analyst-2', 'analyst-3']
      });

      // Should have nodes for each analyst
      const analystNodes = workflow.nodes.filter(n => 
        n.id.includes('a2a-send-analyst-') && n.type === 'agent'
      );
      expect(analystNodes.length).toBeGreaterThanOrEqual(3);
      
      // Should have aggregation node
      const aggregationNode = workflow.nodes.find(n => 
        n.metadata?.aggregation === true
      );
      expect(aggregationNode).toBeDefined();
    });
  });

  describe('MultiAgentCollaborationWorkflow', () => {
    it('should have correct structure', () => {
      expect(MultiAgentCollaborationWorkflow.id).toBe('multi-agent-collaboration');
      expect(MultiAgentCollaborationWorkflow.name).toBe('Multi-Agent Collaboration');
      expect(MultiAgentCollaborationWorkflow.nodes.length).toBeGreaterThan(8);
      expect(MultiAgentCollaborationWorkflow.entryPoint).toBe('a2a-discovery');
    });

    it('should decompose tasks', async () => {
      const decomposeNode = MultiAgentCollaborationWorkflow.nodes.find(
        n => n.id === 'decompose-task'
      );
      expect(decomposeNode).toBeDefined();
      
      const state = {
        task: { name: 'Complex task' }
      };
      
      const result = await decomposeNode!.function(state);
      expect(result.taskDecomposition).toBeDefined();
      expect(result.taskDecomposition.length).toBeGreaterThan(0);
    });

    it('should assign agents to subtasks', async () => {
      const assignNode = MultiAgentCollaborationWorkflow.nodes.find(
        n => n.id === 'assign-agents'
      );
      
      const state = {
        context: {
          discoveryResult: {
            agents: ['agent-1', 'agent-2', 'agent-3']
          }
        },
        taskDecomposition: [
          { id: 'task-1' },
          { id: 'task-2' }
        ]
      };
      
      const result = await assignNode!.function(state);
      expect(result.agentAssignments).toBeDefined();
      expect(result.agentAssignments['task-1']).toBeDefined();
      expect(result.agentAssignments['task-2']).toBeDefined();
    });

    it('should check consensus', async () => {
      const checkNode = MultiAgentCollaborationWorkflow.nodes.find(
        n => n.id === 'check-consensus'
      );
      
      // Test before consensus
      const state1 = {
        context: {
          negotiation: { currentRound: 1 }
        }
      };
      
      const result1 = await checkNode!.function(state1);
      expect(result1.consensus).toBe(false);
      
      // Test after consensus
      const state2 = {
        context: {
          negotiation: { currentRound: 3 }
        }
      };
      
      const result2 = await checkNode!.function(state2);
      expect(result2.consensus).toBe(true);
    });

    it('should calculate collaboration metrics', async () => {
      const metricsNode = MultiAgentCollaborationWorkflow.nodes.find(
        n => n.id === 'calculate-metrics'
      );
      
      const state = {
        agentAssignments: {
          'task-1': ['agent-1'],
          'task-2': ['agent-2']
        },
        agentResults: {
          'task-1': { result: 'done' },
          'task-2': { result: 'done' }
        },
        negotiationRounds: 2,
        consensus: true,
        context: {
          workflowStartTime: Date.now() - 5000
        }
      };
      
      const result = await metricsNode!.function(state);
      expect(result.collaborationMetrics).toBeDefined();
      expect(result.collaborationMetrics.totalAgents).toBe(2);
      expect(result.collaborationMetrics.efficiency).toBe(1);
      expect(result.collaborationMetrics.consensusAchieved).toBe(true);
    });
  });

  describe('createCustomCollaborationWorkflow', () => {
    it('should create workflow with custom task', () => {
      const customTask = {
        name: 'Custom collaborative task',
        requirements: ['req1', 'req2']
      };
      
      const workflow = createCustomCollaborationWorkflow({
        task: customTask,
        maxNegotiationRounds: 10,
        consensusThreshold: 0.9
      });

      expect(workflow.stateSchema.task.value).toEqual(customTask);
    });

    it('should use required agents when specified', () => {
      const workflow = createCustomCollaborationWorkflow({
        task: { name: 'Test' },
        requiredAgents: ['agent-a', 'agent-b', 'agent-c']
      });

      // Should skip discovery and use setup node
      const discoveryNode = workflow.nodes.find(n => n.id === 'a2a-discovery');
      expect(discoveryNode).toBeUndefined();
      
      const setupNode = workflow.nodes.find(n => n.id === 'setup-agents');
      expect(setupNode).toBeDefined();
      expect(workflow.entryPoint).toBe('setup-agents');
    });

    it('should configure parallel execution', () => {
      const workflow = createCustomCollaborationWorkflow({
        task: { name: 'Test' },
        parallelExecution: true
      });

      expect(workflow.config?.parallelLimit).toBe(10);
    });

    it('should set custom consensus threshold', () => {
      const workflow = createCustomCollaborationWorkflow({
        task: { name: 'Test' },
        consensusThreshold: 0.95
      });

      const negotiationNode = workflow.nodes.find(
        n => n.id === 'a2a-negotiate-solution-consensus'
      );
      
      expect(negotiationNode?.metadata?.consensusThreshold).toBe(0.95);
    });
  });
});