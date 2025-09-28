/**
 * Helper utilities for SDK examples
 */

import { TriProtocolSDK } from '../../sdk/src/TriProtocolSDK';

/**
 * Creates an agent and ensures it's built
 * Handles both template-based creation (returns agent directly)
 * and builder-based creation (needs to call build())
 */
export async function createAgentSafe(
  sdk: TriProtocolSDK,
  name: string,
  template?: string
): Promise<any> {
  const result = await sdk.createAgent(name, template);

  // If it has a build method, it's a builder
  if (result && typeof result.build === 'function') {
    return await result.build();
  }

  // Otherwise it's already an agent
  return result;
}

/**
 * Creates a workflow and ensures it's built
 */
export async function createWorkflowSafe(
  sdk: TriProtocolSDK,
  name: string
): Promise<any> {
  const builder = await sdk.createWorkflow(name);

  // Workflow always returns a builder
  return builder;
}