import { SDKError } from '../types';

export class Serializers {
  /**
   * Serialize agent for export
   */
  static serializeAgent(agent: any): string {
    try {
      const serializable = {
        id: agent.id,
        name: agent.name,
        description: agent.description,
        capabilities: agent.capabilities,
        tools: agent.tools,
        memory: agent.memory,
        config: agent.__agentConfig || {}
      };

      return JSON.stringify(serializable, null, 2);
    } catch (error) {
      throw new SDKError('Failed to serialize agent', 'SERIALIZATION_ERROR', error);
    }
  }

  /**
   * Deserialize agent from import
   */
  static deserializeAgent(data: string): any {
    try {
      const parsed = JSON.parse(data);

      if (!parsed.id || !parsed.name) {
        throw new Error('Invalid agent data: missing id or name');
      }

      return parsed;
    } catch (error) {
      throw new SDKError('Failed to deserialize agent', 'DESERIALIZATION_ERROR', error);
    }
  }

  /**
   * Serialize workflow for export
   */
  static serializeWorkflow(workflow: any): string {
    try {
      const serializable = {
        id: workflow.id,
        name: workflow.name,
        description: workflow.description,
        nodes: workflow.nodes,
        edges: workflow.edges,
        config: workflow.__workflowConfig || {}
      };

      return JSON.stringify(serializable, null, 2);
    } catch (error) {
      throw new SDKError('Failed to serialize workflow', 'SERIALIZATION_ERROR', error);
    }
  }

  /**
   * Deserialize workflow from import
   */
  static deserializeWorkflow(data: string): any {
    try {
      const parsed = JSON.parse(data);

      if (!parsed.id || !parsed.name) {
        throw new Error('Invalid workflow data: missing id or name');
      }

      if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
        throw new Error('Invalid workflow data: nodes and edges must be arrays');
      }

      return parsed;
    } catch (error) {
      throw new SDKError('Failed to deserialize workflow', 'DESERIALIZATION_ERROR', error);
    }
  }

  /**
   * Serialize SDK configuration
   */
  static serializeConfig(config: any): string {
    try {
      // Remove sensitive information
      const sanitized = { ...config };

      if (sanitized.llm?.apiKey) {
        sanitized.llm.apiKey = '***REDACTED***';
      }

      if (sanitized.persistence?.config?.password) {
        sanitized.persistence.config.password = '***REDACTED***';
      }

      return JSON.stringify(sanitized, null, 2);
    } catch (error) {
      throw new SDKError('Failed to serialize config', 'SERIALIZATION_ERROR', error);
    }
  }

  /**
   * Convert agent to YAML format
   */
  static agentToYAML(agent: any): string {
    const yaml: string[] = [];

    // Escape special characters in strings
    const escapeYAML = (str: string) => {
      if (str.includes(':') || str.includes('"') || str.includes("'")) {
        return `"${str.replace(/"/g, '\\"')}"`;
      }
      return str;
    };

    yaml.push(`id: ${agent.id}`);
    yaml.push(`name: ${escapeYAML(agent.name)}`);

    if (agent.description) {
      yaml.push(`description: ${escapeYAML(agent.description)}`);
    }

    if (agent.capabilities && agent.capabilities.length > 0) {
      yaml.push('capabilities:');
      agent.capabilities.forEach((cap: string) => yaml.push(`  - ${cap}`));
    }

    if (agent.tools && agent.tools.length > 0) {
      yaml.push('tools:');
      agent.tools.forEach((tool: string) => yaml.push(`  - ${tool}`));
    }

    if (agent.memory) {
      yaml.push('memory:');
      yaml.push(`  enabled: ${agent.memory.enabled}`);
      yaml.push(`  type: ${agent.memory.type}`);
    }

    return yaml.join('\n');
  }

  /**
   * Convert workflow to Mermaid diagram
   */
  static workflowToMermaid(workflow: any): string {
    const lines: string[] = ['graph TD'];

    // Handle missing nodes or edges
    if (!workflow.nodes || !Array.isArray(workflow.nodes)) {
      return 'graph TD';
    }

    // Add nodes
    workflow.nodes.forEach((node: any) => {
      let shape = '[]'; // Default rectangle

      switch (node.type) {
        case 'condition':
          shape = '{}'; // Diamond
          break;
        case 'parallel-start':
        case 'parallel-end':
          shape = '(())'; // Circle
          break;
        case 'loop-start':
        case 'loop-end':
          shape = '[[]]'; // Stadium
          break;
      }

      const label = node.config?.name || node.label || node.type;
      // Escape special characters in node names
      const escapedLabel = label.replace(/[\[\]()<>"']/g, (char: string) => `\\${char}`);
      lines.push(`    ${node.id}[${escapedLabel}]`);
    });

    // Add edges
    if (workflow.edges && Array.isArray(workflow.edges)) {
      workflow.edges.forEach((edge: any) => {
      let arrow = '-->';

      if (edge.type === 'conditional') {
        arrow = '-.->'; // Dotted
      } else if (edge.type === 'loop') {
        arrow = '===>'; // Thick
      }

      const label = edge.condition ? `|${edge.condition}|` : '';
        lines.push(`    ${edge.from} ${arrow}${label} ${edge.to}`);
      });
    }

    return lines.join('\n');
  }

  /**
   * Export multiple agents as bundle
   */
  static bundleAgents(agents: any[]): string {
    try {
      const bundle = {
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        agents: agents.map((agent) => ({
          id: agent.id,
          name: agent.name,
          description: agent.description,
          capabilities: agent.capabilities,
          tools: agent.tools,
          memory: agent.memory
        }))
      };

      return JSON.stringify(bundle, null, 2);
    } catch (error) {
      throw new SDKError('Failed to bundle agents', 'SERIALIZATION_ERROR', error);
    }
  }

  /**
   * Export multiple workflows as bundle
   */
  static bundleWorkflows(workflows: any[]): string {
    try {
      const bundle = {
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        workflows: workflows.map((workflow) => ({
          id: workflow.id,
          name: workflow.name,
          description: workflow.description,
          nodes: workflow.nodes,
          edges: workflow.edges
        }))
      };

      return JSON.stringify(bundle, null, 2);
    } catch (error) {
      throw new SDKError('Failed to bundle workflows', 'SERIALIZATION_ERROR', error);
    }
  }

  /**
   * Compress data for storage
   */
  static compress(data: string): string {
    // Simple base64 encoding for now
    // In production, use proper compression library
    return 'compressed:' + Buffer.from(data).toString('base64');
  }

  /**
   * Decompress data from storage
   */
  static decompress(data: string): string {
    // Simple base64 decoding for now
    // In production, use proper compression library
    const compressed = data.startsWith('compressed:') ? data.slice('compressed:'.length) : data;
    return Buffer.from(compressed, 'base64').toString('utf-8');
  }

  /**
   * Sanitize data for safe storage
   */
  static sanitize(data: any): any {
    if (typeof data === 'string') {
      // Remove all HTML tags
      return data
        .replace(/<script[^>]*>.*?<\/script>/gi, '')
        .replace(/<iframe[^>]*>.*?<\/iframe>/gi, '')
        .replace(/<[^>]*>/g, '') // Remove all HTML tags
        .replace(/javascript:/gi, '');
    }

    if (Array.isArray(data)) {
      return data.map((item) => this.sanitize(item));
    }

    if (data && typeof data === 'object') {
      const sanitized: any = {};
      for (const key in data) {
        sanitized[key] = this.sanitize(data[key]);
      }
      return sanitized;
    }

    return data;
  }
}