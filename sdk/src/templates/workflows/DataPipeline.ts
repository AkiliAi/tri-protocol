import { WorkflowTemplate, SDKWorkflow } from '../../types';
import { TriProtocolSDK } from '../../TriProtocolSDK';

export class DataPipelineTemplate implements WorkflowTemplate {
  name = 'data-pipeline';
  description = 'ETL workflow for data processing';

  async create(sdk: TriProtocolSDK): Promise<SDKWorkflow> {
    const workflow = await sdk.createWorkflow('DataPipeline');

    return workflow
      .withDescription(this.description)
      .withTimeout(300000) // 5 minutes
      .withRetries(3)
      .withCheckpointing(true)
      .addStep({
        type: 'tool',
        config: {
          tool: 'data-reader',
          action: 'extract',
          description: 'Extract data from source'
        }
      })
      .transform((data: any) => {
        // Data cleaning and validation
        if (!data) throw new Error('No data to transform');
        return {
          ...data,
          processed: true,
          timestamp: new Date().toISOString()
        };
      })
      .parallel(
        {
          type: 'agent',
          config: {
            agentId: 'analyst',
            action: 'analyze',
            description: 'Analyze data quality'
          }
        },
        {
          type: 'agent',
          config: {
            agentId: 'validator',
            action: 'validate',
            description: 'Validate data integrity'
          }
        }
      )
      .addStep({
        type: 'tool',
        config: {
          tool: 'data-writer',
          action: 'load',
          description: 'Load data to destination'
        }
      })
      .addStep({
        type: 'tool',
        config: {
          tool: 'notifier',
          action: 'notify',
          description: 'Send completion notification'
        }
      })
      .build();
  }
}