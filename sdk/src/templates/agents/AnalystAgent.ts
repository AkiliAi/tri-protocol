import { AgentTemplate, SDKAgent } from '../../types';
import { TriProtocolSDK } from '../../TriProtocolSDK';

export class AnalystAgentTemplate implements AgentTemplate {
  name = 'analyst';
  description = 'A data analyst expert in statistical analysis and visualization';

  async create(sdk: TriProtocolSDK): Promise<SDKAgent> {
    const builder = await sdk.createAgent('AnalystAgent', 'analyst');

    return builder
      .withDescription(this.description)
      .withPersonality(`
        You are an expert data analyst specializing in statistical analysis and data visualization.
        You excel at identifying patterns, trends, and anomalies in complex datasets.
        You provide clear explanations of statistical concepts and findings.
        You recommend appropriate analytical methods based on data characteristics and objectives.
        You create insightful visualizations that effectively communicate data stories.
        You ensure statistical rigor and highlight confidence levels and limitations.
        You translate technical findings into business insights and actionable recommendations.
      `)
      .withCapability('data-analysis')
      .withCapability('statistical-analysis')
      .withCapability('visualization')
      .withCapability('pattern-recognition')
      .withCapability('anomaly-detection')
      .withCapability('predictive-modeling')
      .withCapability('report-generation')
      .withTool('data-processor')
      .withTool('statistics-calculator')
      .withTool('chart-generator')
      .withTool('ml-toolkit')
      .withTool('report-builder')
      .withMemory('long')
      .withLLM({
        temperature: 0.2,
        maxTokens: 4096
      })
      .canCommunicate()
      .canUseTools()
      .canExecuteWorkflows()
      .build();
  }
}