// tests/diagnostic-test.ts
import { A2AAgentRegistry } from '../protocols/src/a2a/A2AAgentRegistry';
import { AgentProfile, AgentStatus } from '../protocols/src/a2a/types';

async function diagnosticTest() {
    console.log('🔬 Diagnostic Test for A2AAgentRegistry\n');

    // 1. Vérifier l'import
    console.log('1️⃣ Import Check:');
    console.log('  - A2AAgentRegistry type:', typeof A2AAgentRegistry);
    console.log('  - Is constructor:', A2AAgentRegistry.prototype?.constructor === A2AAgentRegistry);

    // 2. Créer une instance
    console.log('\n2️⃣ Instance Creation:');
    let registry: any;
    try {
        registry = new A2AAgentRegistry();
        console.log('  ✅ Instance created successfully');
        console.log('  - Instance type:', typeof registry);
        console.log('  - Constructor name:', registry.constructor.name);
    } catch (error) {
        console.error('  ❌ Failed to create instance:', error);
        return;
    }

    // 3. Vérifier les méthodes
    console.log('\n3️⃣ Method Verification:');
    const methods = ['registerAgent', 'findByType', 'getAgent', 'unregisterAgent'];
    for (const method of methods) {
        const hasMethod = method in registry;
        const methodType = typeof registry[method];
        console.log(`  - ${method}: ${hasMethod ? '✅' : '❌'} (type: ${methodType})`);
    }

    // 4. Tester registerAgent
    console.log('\n4️⃣ Testing registerAgent:');
    const profile: AgentProfile = {
        agentId: 'test-001',
        agentType: 'TestAgent',
        name: 'Test Agent',
        description: 'Test',
        status: AgentStatus.ONLINE,
        capabilities: [{
            name: 'test-cap',
            description: 'Test capability',
            version: '1.0.0',
            category: 'test' as any,
            inputs: [],
            outputs: [],
            id: '',
            cost: 0,
            reliability: 0
        }],
        metadata: {} as any
    };

    try {
        console.log('  - Calling registerAgent...');
        const result = await registry.registerAgent(profile);
        console.log('  - Result type:', typeof result);
        console.log('  - Result value:', result);

        if (result === undefined) {
            console.error('  ❌ registerAgent returned undefined!');

            // Essayer d'appeler directement la méthode
            console.log('\n  Trying direct prototype call:');
            const proto = Object.getPrototypeOf(registry);
            const directResult = await proto.registerAgent.call(registry, profile);
            console.log('  - Direct result:', directResult);
        } else {
            console.log('  ✅ registerAgent returned:', result);
        }
    } catch (error) {
        console.error('  ❌ Error calling registerAgent:', error);
    }

    // 5. Vérifier le prototype
    console.log('\n5️⃣ Prototype Chain:');
    let proto = Object.getPrototypeOf(registry);
    let level = 0;
    while (proto && level < 5) {
        console.log(`  Level ${level}: ${proto.constructor.name}`);
        const ownProps = Object.getOwnPropertyNames(proto);
        const methods = ownProps.filter(p => typeof proto[p] === 'function' && p !== 'constructor');
        console.log(`    Methods (${methods.length}):`, methods.slice(0, 5).join(', '), '...');
        proto = Object.getPrototypeOf(proto);
        level++;
    }
}

diagnosticTest().catch(console.error);