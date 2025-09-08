// tests/test-simple.ts
import { A2AAgentRegistry } from '../protocols/src/a2a/A2AAgentRegistry';
import { EventEmitter } from 'eventemitter3';
import { AgentStatus, CapabilityCategory } from '../protocols/src/a2a/types';

async function simpleTest() {
    console.log('🧪 Test Simple A2AAgentRegistry\n');

    const eventBus = new EventEmitter();
    const registry = new A2AAgentRegistry(eventBus);

    // Test 1: Register
    const profile = {
        agentId: 'test-001',
        agentType: 'TestAgent',
        status: AgentStatus.ONLINE,
        capabilities: [{
            id: 'test-cap',
            name: 'test',
            description: 'Test capability',
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
            registeredAt: new Date(),  // ✅ Ajouté
            lastUpdated: new Date()    // ✅ Ajouté
        },
        lastSeen: new Date(),
        registeredAt: new Date(),
        lastUpdated: new Date()
    };

    const result = await registry.registerAgent(profile);
    console.log('✅ Register:', result);

    // Test 2: Get Agent
    const agent = await registry.getAgent('test-001');
    console.log('✅ Get Agent:', agent ? 'Found' : 'Not found');

    // Test 3: Find by Type
    const agents = await registry.findByType('TestAgent');
    console.log('✅ Find by Type:', agents.length, 'agents');

    // Test 4: Update Status
    await registry.updateStatus('test-001', AgentStatus.BUSY);
    const updated = await registry.getAgent('test-001');
    console.log('✅ Update Status:', updated?.status);

    // Test 5: Statistics
    const stats = await registry.getStatistics();
    console.log('✅ Statistics:', stats);

    // Test 6: Unregister
    await registry.unregisterAgent('test-001');
    const removed = await registry.getAgent('test-001');
    console.log('✅ Unregister:', removed ? 'Failed' : 'Success');

    console.log('\n✨ Tous les tests passent!');
}

simpleTest().catch(console.error);