/**
 * Simple Debate System - Quick demonstration
 * A simplified version for testing the debate functionality
 */

import { TriProtocolSDK } from '../sdk/src/TriProtocolSDK';
import { LoggerManager } from '../logger/src';

async function simpleDebate() {
  const logger = LoggerManager.getLogger('SimpleDebate');

  logger.info('🎭 Starting Simple Debate System...\n');

  try {
    // Initialize SDK
    const sdk = await TriProtocolSDK.quickStart('simple-debate');
    logger.info('✅ SDK initialized\n');

    // Topic for debate
    const topic = "Remote work is more productive than office work";
    logger.info(`📋 Debate Topic: "${topic}"\n`);

    // Create Pro Debater
    logger.info('Creating Pro debater...');
    const proDebaterBuilder = await sdk.createAgent('ProDebater');
    const proDebater = await proDebaterBuilder
      .withDescription(`Debater arguing FOR: ${topic}`)
      .withCapability('argumentation')
      .withSystemPrompt(`You are debating FOR the topic: "${topic}".
        Present strong logical arguments with examples. Be concise but persuasive.`)
      .build();

    // Create Con Debater
    logger.info('Creating Con debater...');
    const conDebaterBuilder = await sdk.createAgent('ConDebater');
    const conDebater = await conDebaterBuilder
      .withDescription(`Debater arguing AGAINST: ${topic}`)
      .withCapability('argumentation')
      .withSystemPrompt(`You are debating AGAINST the topic: "${topic}".
        Present strong counter-arguments with evidence. Be concise but convincing.`)
      .build();

    // Create Judge
    logger.info('Creating Judge...');
    const judgeBuilder = await sdk.createAgent('Judge');
    const judge = await judgeBuilder
      .withDescription('Impartial debate judge')
      .withCapability('evaluation')
      .withSystemPrompt(`You are an impartial judge. Evaluate arguments based on:
        1. Logic and reasoning
        2. Evidence quality
        3. Persuasiveness
        Declare a winner and explain your decision briefly.`)
      .build();

    logger.info('✅ All agents created\n');
    logger.info('═══════════════════════════════════════════════\n');

    // Debate Round 1
    logger.info('🔔 ROUND 1 - Opening Arguments\n');

    const proArg1 = await proDebater.respond(
      'Present your opening argument for why remote work is more productive. Use 2-3 key points.'
    );
    logger.info('🟢 PRO:', proArg1, '\n');

    const conArg1 = await conDebater.respond(
      'Present your opening argument against remote work being more productive. Use 2-3 key points.'
    );
    logger.info('🔴 CON:', conArg1, '\n');

    logger.info('═══════════════════════════════════════════════\n');

    // Debate Round 2 - Rebuttals
    logger.info('🔔 ROUND 2 - Rebuttals\n');

    const proArg2 = await proDebater.respond(
      `Respond to this opposing argument and strengthen your position: "${conArg1}"`
    );
    logger.info('🟢 PRO:', proArg2, '\n');

    const conArg2 = await conDebater.respond(
      `Respond to this opposing argument and strengthen your position: "${proArg1}"`
    );
    logger.info('🔴 CON:', conArg2, '\n');

    logger.info('═══════════════════════════════════════════════\n');

    // Judge Decision
    logger.info('⚖️ JUDGMENT\n');

    const verdict = await judge.respond(`
      Evaluate this debate and declare a winner.

      Topic: "${topic}"

      PRO Arguments:
      Round 1: ${proArg1}
      Round 2: ${proArg2}

      CON Arguments:
      Round 1: ${conArg1}
      Round 2: ${conArg2}

      Provide your verdict with reasoning.
    `);

    logger.info('Judge:', verdict, '\n');
    logger.info('═══════════════════════════════════════════════\n');

    // Shutdown
    await sdk.shutdown();
    logger.info('✅ Debate completed successfully!');

  } catch (error) {
    logger.error('Debate failed:', error);

    // Try to provide more specific error information
    if (error instanceof Error) {
      logger.error('Error message:', error.message);
      logger.error('Stack trace:', error.stack);
    }
  }
}

// Run the debate
simpleDebate().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});