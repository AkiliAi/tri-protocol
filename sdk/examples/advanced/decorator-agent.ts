/**
 * Decorator-based Agent Example
 * This example shows how to create agents using TypeScript decorators
 */

import {
  TriProtocolSDK,
  Agent,
  Capability,
  Tool,
  Memory,
  On,
  Before,
  After,
  InjectSDK,
  SDKAgent
} from '@tri-protocol/sdk';

// Define a custom agent using decorators
@Agent({
  name: 'SmartAssistant',
  description: 'An intelligent assistant with multiple capabilities',
  systemPrompt: 'You are a highly capable AI assistant with expertise in various domains.'
})
@Memory('both', { maxEntries: 100, ttl: 3600 })
export class SmartAssistant extends SDKAgent {
  @InjectSDK()
  private sdk!: TriProtocolSDK;

  private taskCount = 0;

  @Before()
  async beforeTask() {
    console.log('Preparing to execute task...');
    this.taskCount++;
  }

  @After()
  async afterTask() {
    console.log(`Task completed. Total tasks: ${this.taskCount}`);
  }

  @Capability('schedule', 'Schedule and manage tasks')
  async scheduleTask(task: string, when: Date) {
    console.log(`Scheduling: ${task} at ${when.toISOString()}`);

    // Use memory to store scheduled tasks
    const scheduled = await this.recall('scheduled_tasks') || [];
    scheduled.push({ task, when, id: Date.now() });
    await this.remember('scheduled_tasks', scheduled);

    return {
      success: true,
      message: `Task "${task}" scheduled for ${when.toLocaleDateString()}`,
      taskId: scheduled[scheduled.length - 1].id
    };
  }

  @Capability('research', 'Conduct research on topics')
  async research(topic: string, depth: 'quick' | 'thorough' = 'quick') {
    console.log(`Researching: ${topic} (${depth})`);

    const prompt = depth === 'thorough'
      ? `Conduct thorough research on: ${topic}. Include multiple perspectives, sources, and detailed analysis.`
      : `Provide a quick overview of: ${topic}`;

    const result = await this.think(prompt);

    // Store research in memory
    await this.remember(`research_${topic}`, {
      topic,
      depth,
      result,
      timestamp: new Date().toISOString()
    });

    return result;
  }

  @Tool('calculator', {
    description: 'Perform mathematical calculations',
    parameters: {
      expression: { type: 'string', description: 'Math expression to evaluate' }
    }
  })
  async calculate(expression: string): Promise<number> {
    console.log(`Calculating: ${expression}`);

    // Simple evaluation (in production, use a proper math library)
    try {
      // WARNING: eval is dangerous, use math.js or similar in production
      const result = Function(`"use strict"; return (${expression})`)();
      return result;
    } catch (error) {
      throw new Error(`Invalid expression: ${expression}`);
    }
  }

  @Tool('reminder', {
    description: 'Set a reminder',
    parameters: {
      message: { type: 'string' },
      delay: { type: 'number', description: 'Delay in milliseconds' }
    }
  })
  async setReminder(message: string, delay: number): Promise<void> {
    console.log(`Setting reminder: "${message}" in ${delay}ms`);

    setTimeout(() => {
      this.emit('reminder', { message, timestamp: new Date().toISOString() });
    }, delay);
  }

  @On('reminder')
  async handleReminder(data: any) {
    console.log(`⏰ Reminder: ${data.message}`);
  }

  @On('task:completed')
  async onTaskCompleted(task: any) {
    console.log(`✅ Task completed:`, task);

    // Update task statistics
    const stats = await this.recall('task_stats') || { completed: 0 };
    stats.completed++;
    await this.remember('task_stats', stats);
  }

  // Custom methods
  async summarizeDay(): Promise<string> {
    const scheduled = await this.recall('scheduled_tasks') || [];
    const stats = await this.recall('task_stats') || { completed: 0 };

    const today = new Date().toDateString();
    const todayTasks = scheduled.filter((t: any) =>
      new Date(t.when).toDateString() === today
    );

    return this.think(`
      Summarize the day:
      - Scheduled tasks for today: ${todayTasks.length}
      - Total completed tasks: ${stats.completed}
      - Tasks: ${JSON.stringify(todayTasks)}

      Provide a brief, friendly summary.
    `);
  }

  async brainstorm(topic: string, count: number = 5): Promise<string[]> {
    const prompt = `Generate ${count} creative ideas related to: ${topic}`;
    const response = await this.think(prompt);

    // Parse response into array (assumes numbered list)
    const ideas = response
      .split('\n')
      .filter(line => line.trim())
      .map(line => line.replace(/^\d+\.\s*/, ''));

    // Store brainstorming session
    await this.remember(`brainstorm_${Date.now()}`, {
      topic,
      ideas,
      timestamp: new Date().toISOString()
    });

    return ideas;
  }
}

// Usage example
async function main() {
  const sdk = await TriProtocolSDK.initialize({
    mode: 'development',
    persistence: {
      enabled: true,
      backend: 'memory'
    }
  });

  // Register the custom agent class
  const assistant = await sdk.registerAgent(SmartAssistant);

  // Use the agent's capabilities
  const scheduled = await assistant.scheduleTask(
    'Review quarterly reports',
    new Date(Date.now() + 86400000) // Tomorrow
  );
  console.log('Scheduled:', scheduled);

  // Do research
  const research = await assistant.research('quantum computing applications', 'quick');
  console.log('Research:', research);

  // Use tools
  const calc = await assistant.calculate('(10 + 20) * 3');
  console.log('Calculation result:', calc);

  // Set a reminder
  await assistant.setReminder('Check the scheduled task', 5000);

  // Brainstorm ideas
  const ideas = await assistant.brainstorm('sustainable energy solutions');
  console.log('Ideas:', ideas);

  // Get day summary
  const summary = await assistant.summarizeDay();
  console.log('Day Summary:', summary);

  // Wait for reminder to trigger
  await new Promise(resolve => setTimeout(resolve, 6000));

  await sdk.shutdown();
}

main().catch(console.error);