// packages/core/src/integrations/A2ATriAgentIntegration.ts
import {
    AgentCard,
    AgentCapability,
    AgentSkill,
    Message,
    Task,
    Part
} from '@tri-protocol/protocols/a2a';
import { A2AAgentServer } from '@tri-protocol/protocols/a2a';

export class A2ATriAgentBridge {
    private server: A2AAgentServer;

    // Convert TriAgent to AgentCard
    static createAgentCard(triAgent: TriAgent): AgentCard {
        const capabilities = triAgent.getCapabilities();

        return {
            protocolVersion: '1.0',
            name: triAgent.name,
            description: triAgent.description,
            url: `http://localhost:${8080 + Math.floor(Math.random() * 1000)}`,
            preferredTransport: TransportProtocol.JSONRPC,
            version: '1.0.0',
            capabilities: {
                streaming: true,
                pushNotifications: true
            },
            skills: capabilities.map(cap => ({
                id: cap.id,
                name: cap.name,
                description: cap.description,
                tags: cap.tags
            })),
            securitySchemes: [
                {
                    type: 'http',
                    scheme: 'bearer'
                }
            ]
        };
    }

    // Setup A2A server for TriAgent
    async setupA2AServer(triAgent: TriAgent, port: number): Promise<A2AAgentServer> {
        const agentCard = A2ATriAgentBridge.createAgentCard(triAgent);
        const server = new A2AAgentServer(agentCard, port);

        // Register message handler
        server.registerMessageHandler(async (message: Message) => {
            // Convert A2A message to TriAgent format
            const response = await triAgent.handleA2AMessage({
                id: message.messageId,
                from: 'user',
                to: triAgent.id,
                type: A2AMessageType.TASK_REQUEST,
                payload: message,
                timestamp: new Date(),
                priority: 'normal'
            });

            // Convert response back to A2A format
            return {
                role: 'agent',
                parts: [
                    {
                        kind: 'text',
                        text: response.data
                    }
                ],
                messageId: uuidv4(),
                kind: 'message'
            };
        });

        return server;
    }
}