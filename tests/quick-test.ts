// tests/quick-test.ts
import { A2AAgentRegistry } from '../protocols/src/a2a/A2AAgentRegistry';
import { EventEmitter } from 'eventemitter3';
import { AgentProfile, AgentStatus, CapabilityCategory, AgentHealth } from '../protocols/src/a2a/types';

async function quickTest() {
    console.log('🧪 Testing A2AAgentRegistry...\n');

    const eventBus = new EventEmitter();
    const registry = new A2AAgentRegistry(eventBus);

    // Test 1: Register Agent
    const profile: AgentProfile = {
        agentId: 'test-001',
        agentType: 'TestAgent',
        status: AgentStatus.ONLINE,
        capabilities: [{
            id: 'test-cap',
            name: 'Test Capability',
            description: 'Test',
            category: CapabilityCategory.ANALYSIS,
            inputs: [],
            outputs: [],
            cost: 10,
            reliability: 0.95,
            version: '1.0.0'
        }],
        systemFeatures: {
            streaming: false,
            pushNotifications: false
        },
        metadata: {
            version: '1.0.0',
            location: 'agent://test-001',
            load: 0,
            uptime: Date.now(),
            capabilities_count: 1,
            registeredAt: new Date(),
            lastUpdated: new Date(),
        },
        lastSeen: new Date()
    };

    const result = await registry.registerAgent(profile);
    console.log('✅ Register Agent:', result);

    // IMPORTANT: Vérifiez que l'enregistrement a réussi
    if (!result.success) {
        console.error('❌ Failed to register agent:', result.error);
        return;
    }

    // Test 2: Find by Type
    try {
        const agents = await registry.findByType('TestAgent');
        console.log('✅ Find by Type:', agents.length, 'agents found');
    } catch (error) {
        console.error('❌ Find by Type error:', error);
    }

    // Test 3: Update Health
    try {
        await registry.updateHealth('test-001', {
            cpu: 45,
            memory: 60,
            responseTime: 120,
            errorRate: 0.02
        });

        const health = await registry.getHealth('test-001');
        console.log('✅ Health Update:', health);
    } catch (error) {
        console.error('❌ Health Update error:', error);
    }

    // Test 4: Set Metadata
    try {
        await registry.setMetadata('test-001', 'customField', 'customValue');
        const metadata = await registry.getMetadata('test-001');
        console.log('✅ Metadata:', metadata);
    } catch (error) {
        console.error('❌ Metadata error:', error);
    }

    // Test 5: Statistics
    try {
        const stats = await registry.getStatistics();
        console.log('✅ Statistics:', stats);
    } catch (error) {
        console.error('❌ Statistics error:', error);
    }

    // Test 6: Find by Status
    try {
        const onlineAgents = await registry.findByStatus(AgentStatus.ONLINE);
        console.log('✅ Find by Status:', onlineAgents.length, 'online agents');
    } catch (error) {
        console.error('❌ Find by Status error:', error);
    }

    // Test 7: Capability Distribution
    try {
        const distribution = await registry.getCapabilityDistribution();
        console.log('✅ Capability Distribution:', distribution);
    } catch (error) {
        console.error('❌ Capability Distribution error:', error);
    }

    console.log('\n🎉 Tests completed!');
}

quickTest().catch(console.error);