// tests/unit/protocols/a2a/A2AClient.test.ts
import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals';
import axios from 'axios';
import { A2AClient, A2AClientConfig } from '../../../../protocols/src/a2a/A2AClient';
import {
    AgentCard,
    MessageSendParameters,
    SendMessageResponse,
    Message,
    Task,
    TaskPushNotificationConfig,
    TaskIdParameters,
    TaskQueryParameters,
    A2AError,
    JSONRPCErrorResponse,
    TaskStatusUpdateEvent,
    TaskArtifactUpdateEvent,
    DeleteTaskPushNotificationConfigParams
} from '../../../../protocols/src/a2a/types';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Mock fetch for SSE streaming
global.fetch = jest.fn() as jest.MockedFunction<typeof fetch>;

describe('A2AClient', () => {
    let client: A2AClient;
    let mockAxiosInstance: any;
    const baseUrl = 'http://localhost:8080';
    const agentCardPath = '/.well-known/ai-agent';

    // Mock Agent Card
    const mockAgentCard: AgentCard = {
        protocolVersion: '1.0',
        name: 'Test Agent',
        url: 'http://localhost:8080/jsonrpc',
        preferredTransport: 'HTTP+JSON',
        skills: [],
        capabilities: []
    };

    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks();

        // Setup axios mock
        mockAxiosInstance = {
            get: jest.fn(),
            post: jest.fn(),
            interceptors: {
                request: { use: jest.fn() },
                response: { use: jest.fn() }
            }
        };

        mockedAxios.create.mockReturnValue(mockAxiosInstance);

        // Create client
        client = new A2AClient(baseUrl, agentCardPath);
    });

    afterEach(() => {
        client.close();
    });

    describe('Constructor and Configuration', () => {
        it('should initialize with default configuration', () => {
            expect(mockedAxios.create).toHaveBeenCalledWith({
                baseURL: baseUrl,
                timeout: 30000,
                headers: {
                    'Content-Type': 'application/json',
                    'X-Agent-Protocol': 'a2a/1.0'
                }
            });
        });

        it('should initialize with custom configuration', () => {
            const config: A2AClientConfig = {
                timeout: 60000,
                headers: { 'Custom-Header': 'value' },
                retries: 3,
                credentials: { token: 'test-token' }
            };

            const customClient = new A2AClient(baseUrl, agentCardPath, config);

            expect(mockedAxios.create).toHaveBeenCalledWith({
                baseURL: baseUrl,
                timeout: 60000,
                headers: {
                    'Content-Type': 'application/json',
                    'X-Agent-Protocol': 'a2a/1.0',
                    'Custom-Header': 'value'
                }
            });

            // Check retry interceptor setup
            expect(mockAxiosInstance.interceptors.response.use).toHaveBeenCalled();

            customClient.close();
        });

        it('should remove trailing slash from base URL', () => {
            const clientWithSlash = new A2AClient('http://localhost:8080/', agentCardPath);
            expect(mockedAxios.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    baseURL: 'http://localhost:8080'
                })
            );
            clientWithSlash.close();
        });
    });

    describe('Agent Card Management', () => {
        it('should fetch and cache agent card', async () => {
            mockAxiosInstance.get.mockResolvedValueOnce({ data: mockAgentCard });

            const card = await client.getAgentCard();

            expect(card).toEqual(mockAgentCard);
            expect(mockAxiosInstance.get).toHaveBeenCalledWith(agentCardPath);

            // Second call should use cache
            const cachedCard = await client.getAgentCard();
            expect(cachedCard).toEqual(mockAgentCard);
            expect(mockAxiosInstance.get).toHaveBeenCalledTimes(1); // Not called again
        });

        it('should handle agent card fetch failure', async () => {
            mockAxiosInstance.get.mockRejectedValueOnce(new Error('Network error'));

            await expect(client.getAgentCard()).rejects.toThrow(A2AError);
            await expect(client.getAgentCard()).rejects.toThrow('Failed to fetch agent card');
        });

        it('should emit agentCard:fetched event', async () => {
            mockAxiosInstance.get.mockResolvedValueOnce({ data: mockAgentCard });

            const eventHandler = jest.fn();
            client.on('agentCard:fetched', eventHandler);

            await client.getAgentCard();

            expect(eventHandler).toHaveBeenCalledWith(mockAgentCard);
        });
    });

    describe('RPC Methods', () => {
        beforeEach(() => {
            // Setup agent card fetch
            mockAxiosInstance.get.mockResolvedValueOnce({ data: mockAgentCard });
        });

        describe('sendMessage', () => {
            it('should send message successfully', async () => {
                const params: MessageSendParameters = {
                    message: {
                        role: 'user',
                        parts: [{ kind: 'text', text: 'Hello' }],
                        messageId: 'msg-1',
                        kind: 'message'
                    }
                };

                const mockResponse: SendMessageResponse = {
                    jsonrpc: '2.0',
                    id: '1',
                    result: {
                        role: 'agent',
                        parts: [{ kind: 'text', text: 'Hi there!' }],
                        messageId: 'msg-2',
                        kind: 'message'
                    }
                };

                mockAxiosInstance.post.mockResolvedValueOnce({ data: mockResponse });

                const response = await client.sendMessage(params);

                expect(response).toEqual(mockResponse);
                expect(mockAxiosInstance.post).toHaveBeenCalledWith(
                    'http://localhost:8080/jsonrpc',
                    {
                        jsonrpc: '2.0',
                        id: '1',
                        method: 'message/send',
                        parameters: params
                    },
                    { headers: {} }
                );
            });

            it('should emit message:sent event', async () => {
                const params: MessageSendParameters = {
                    message: {
                        role: 'user',
                        parts: [{ kind: 'text', text: 'Hello' }],
                        messageId: 'msg-1',
                        kind: 'message'
                    }
                };

                mockAxiosInstance.post.mockResolvedValueOnce({
                    data: { jsonrpc: '2.0', id: '1', result: {} }
                });

                const eventHandler = jest.fn();
                client.on('message:sent', eventHandler);

                await client.sendMessage(params);

                expect(eventHandler).toHaveBeenCalledWith(params.message);
            });
        });

        describe('getTask', () => {
            it('should get task successfully', async () => {
                const params: TaskQueryParameters = {
                    id: 'task-1',
                    historyLength: 10
                };

                const mockTask: Task = {
                    id: 'task-1',
                    contextId: 'ctx-1',
                    status: {
                        state: 'completed',
                        timestamp: new Date().toISOString()
                    },
                    kind: 'task',
                    createdAt: new Date(),
                    updatedAt: new Date()
                };

                mockAxiosInstance.post.mockResolvedValueOnce({
                    data: { jsonrpc: '2.0', id: '1', result: mockTask }
                });

                const response = await client.getTask(params);

                expect(response.result).toEqual(mockTask);
                expect(mockAxiosInstance.post).toHaveBeenCalledWith(
                    'http://localhost:8080/jsonrpc',
                    {
                        jsonrpc: '2.0',
                        id: '1',
                        method: 'tasks/get',
                        parameters: params
                    },
                    { headers: {} }
                );
            });
        });

        describe('cancelTask', () => {
            it('should cancel task and emit event', async () => {
                const params: TaskIdParameters = { id: 'task-1' };

                mockAxiosInstance.post.mockResolvedValueOnce({
                    data: { jsonrpc: '2.0', id: '1', result: { success: true } }
                });

                const eventHandler = jest.fn();
                client.on('task:cancelled', eventHandler);

                await client.cancelTask(params);

                expect(eventHandler).toHaveBeenCalledWith('task-1');
                expect(mockAxiosInstance.post).toHaveBeenCalledWith(
                    'http://localhost:8080/jsonrpc',
                    {
                        jsonrpc: '2.0',
                        id: '1',
                        method: 'tasks/cancel',
                        parameters: params
                    },
                    { headers: {} }
                );
            });
        });

        describe('Push Notification Config', () => {
            it('should set push notification config', async () => {
                const config: TaskPushNotificationConfig = {
                    taskId: 'task-1',
                    pushNotificationConfig: {
                        url: 'http://webhook.url',
                        token: 'webhook-token'
                    }
                };

                mockAxiosInstance.post.mockResolvedValueOnce({
                    data: { jsonrpc: '2.0', id: '1', result: config }
                });

                const response = await client.setTaskPushNotificationConfig(config);

                expect(response.result).toEqual(config);
            });

            it('should list push notification configs', async () => {
                const params: TaskIdParameters = { id: 'task-1' };
                const configs: TaskPushNotificationConfig[] = [
                    {
                        taskId: 'task-1',
                        pushNotificationConfig: {
                            url: 'http://webhook1.url',
                            token: 'token1'
                        }
                    }
                ];

                mockAxiosInstance.post.mockResolvedValueOnce({
                    data: { jsonrpc: '2.0', id: '1', result: configs }
                });

                const response = await client.listTaskPushNotificationConfigs(params);

                expect(response).toEqual(configs);
            });

            it('should delete push notification config', async () => {
                const params: DeleteTaskPushNotificationConfigParams = {
                    id: 'task-1',
                    pushNotificationConfigId: 'config-1'
                };

                mockAxiosInstance.post.mockResolvedValueOnce({
                    data: { jsonrpc: '2.0', id: '1', result: null }
                });

                await client.deleteTaskPushNotificationConfig(params);

                expect(mockAxiosInstance.post).toHaveBeenCalledWith(
                    'http://localhost:8080/jsonrpc',
                    {
                        jsonrpc: '2.0',
                        id: '1',
                        method: 'tasks/pushNotificationConfig/delete',
                        parameters: params
                    },
                    { headers: {} }
                );
            });
        });
    });

    describe('Authentication', () => {
        it('should add Bearer token to requests when credentials provided', async () => {
            const clientWithAuth = new A2AClient(baseUrl, agentCardPath, {
                credentials: { token: 'auth-token-123' }
            });

            mockAxiosInstance.get.mockResolvedValueOnce({ data: mockAgentCard });
            mockAxiosInstance.post.mockResolvedValueOnce({
                data: { jsonrpc: '2.0', id: '1', result: {} }
            });

            await clientWithAuth.getTask({ id: 'task-1' });

            expect(mockAxiosInstance.post).toHaveBeenCalledWith(
                'http://localhost:8080/jsonrpc',
                expect.any(Object),
                {
                    headers: {
                        'Authorization': 'Bearer auth-token-123'
                    }
                }
            );

            clientWithAuth.close();
        });
    });

    describe('SSE Streaming', () => {
        it('should handle message stream', async () => {
            mockAxiosInstance.get.mockResolvedValueOnce({ data: mockAgentCard });

            const mockStreamData = [
                'data: {"kind":"message","role":"agent","parts":[{"kind":"text","text":"Response"}],"messageId":"msg-1"}\n',
                'data: [DONE]\n'
            ];

            const mockReadableStream = new ReadableStream({
                start(controller) {
                    mockStreamData.forEach(chunk => {
                        controller.enqueue(new TextEncoder().encode(chunk));
                    });
                    controller.close();
                }
            });

            (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
                ok: true,
                body: mockReadableStream
            } as Response);

            const params: MessageSendParameters = {
                message: {
                    role: 'user',
                    parts: [{ kind: 'text', text: 'Hello' }],
                    messageId: 'msg-1',
                    kind: 'message'
                }
            };

            const events: any[] = [];
            for await (const event of client.sendMessageStream(params)) {
                events.push(event);
            }

            expect(events).toHaveLength(1);
            expect(events[0].kind).toBe('message');
            expect(events[0].parts[0].text).toBe('Response');
        });

        it('should handle stream errors', async () => {
            mockAxiosInstance.get.mockResolvedValueOnce({ data: mockAgentCard });

            (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
                ok: false,
                statusText: 'Internal Server Error'
            } as Response);

            const params: MessageSendParameters = {
                message: {
                    role: 'user',
                    parts: [{ kind: 'text', text: 'Hello' }],
                    messageId: 'msg-1',
                    kind: 'message'
                }
            };

            const iterator = client.sendMessageStream(params);

            await expect(iterator.next()).rejects.toThrow('Stream request failed');
        });
    });

    describe('Error Handling', () => {
        beforeEach(() => {
            mockAxiosInstance.get.mockResolvedValueOnce({ data: mockAgentCard });
        });

        it('should handle JSONRPC error responses', async () => {
            const errorResponse: JSONRPCErrorResponse = {
                jsonrpc: '2.0',
                id: '1',
                error: {
                    code: -32602,
                    message: 'Invalid params'
                }
            };

            mockAxiosInstance.post.mockResolvedValueOnce({ data: errorResponse });

            await expect(client.getTask({ id: 'invalid' }))
                .rejects.toThrow('Invalid params');
        });

        it('should handle network errors', async () => {
            mockAxiosInstance.post.mockRejectedValueOnce(new Error('Network error'));

            await expect(client.getTask({ id: 'task-1' }))
                .rejects.toThrow('RPC request failed');
        });

        it('should emit error events', async () => {
            mockAxiosInstance.get.mockReset();
            mockAxiosInstance.get.mockRejectedValueOnce(new Error('Network error'));

            const errorHandler = jest.fn();
            client.on('error', errorHandler);

            try {
                await client.getAgentCard();
            } catch (error) {
                // Expected
            }

            expect(errorHandler).toHaveBeenCalled();
        });
    });

    describe('Retry Mechanism', () => {
        it('should setup retry interceptor when retries configured', async () => {
            const clientWithRetry = new A2AClient(baseUrl, agentCardPath, { retries: 2 });

            // Verify that the interceptor was set up during construction
            expect(mockAxiosInstance.interceptors.response.use).toHaveBeenCalled();

            clientWithRetry.close();
        });
    });

    describe('Utility Methods', () => {
        it('should perform health check', async () => {
            mockAxiosInstance.get.mockResolvedValueOnce({
                data: { status: 'healthy', agent: 'test-agent' }
            });

            const health = await client.healthCheck();

            expect(health.status).toBe('healthy');
            expect(mockAxiosInstance.get).toHaveBeenCalledWith('/health');
        });

        it('should get metrics', async () => {
            mockAxiosInstance.get.mockResolvedValueOnce({
                data: { requests: 100, errors: 2 }
            });

            const metrics = await client.getMetrics();

            expect(metrics.requests).toBe(100);
            expect(mockAxiosInstance.get).toHaveBeenCalledWith('/metrics');
        });

        it('should handle metrics not available', async () => {
            mockAxiosInstance.get.mockRejectedValueOnce(new Error('Not found'));

            await expect(client.getMetrics()).rejects.toThrow('Metrics not available');
        });
    });

    describe('Lifecycle', () => {
        it('should emit closing event and cleanup', () => {
            const closingHandler = jest.fn();
            client.on('client:closing', closingHandler);

            client.close();

            expect(closingHandler).toHaveBeenCalled();
            expect(client.listenerCount('client:closing')).toBe(0);
        });

        it('should generate unique request IDs', async () => {
            mockAxiosInstance.get.mockResolvedValueOnce({ data: mockAgentCard });

            const responses: string[] = [];
            mockAxiosInstance.post.mockImplementation((url: string, data: any) => {
                responses.push(data.id);
                return Promise.resolve({ data: { jsonrpc: '2.0', id: data.id, result: {} } });
            });

            await client.getTask({ id: 'task-1' });
            await client.getTask({ id: 'task-2' });

            expect(responses[0]).toBe('1');
            expect(responses[1]).toBe('2');
        });
    });
});