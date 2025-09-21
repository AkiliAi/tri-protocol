// Switch to triprotocol database
db = db.getSiblingDB('triprotocol');

// Create user for the application
db.createUser({
  user: 'triprotocol',
  pwd: 'triprotocol123',
  roles: [
    {
      role: 'readWrite',
      db: 'triprotocol'
    }
  ]
});

// Create collections with validation
db.createCollection('workflows', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['_id', 'name', 'definition'],
      properties: {
        _id: { bsonType: 'string' },
        name: { bsonType: 'string' },
        definition: { bsonType: 'object' },
        created_at: { bsonType: 'date' },
        updated_at: { bsonType: 'date' }
      }
    }
  }
});

db.createCollection('executions', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['_id', 'workflowId', 'status'],
      properties: {
        _id: { bsonType: 'string' },
        workflowId: { bsonType: 'string' },
        status: {
          enum: ['pending', 'running', 'completed', 'failed', 'cancelled']
        }
      }
    }
  }
});

db.createCollection('agent_memories');
db.createCollection('messages');
db.createCollection('tasks');

// Create time-series collection for metrics
db.createCollection('metrics', {
  timeseries: {
    timeField: 'timestamp',
    metaField: 'metadata',
    granularity: 'seconds'
  }
});

// Create indexes
db.workflows.createIndex({ name: 1 });
db.workflows.createIndex({ created_at: -1 });

db.executions.createIndex({ workflowId: 1 });
db.executions.createIndex({ status: 1 });
db.executions.createIndex({ startTime: -1 });

db.agent_memories.createIndex({ agent_id: 1, timestamp: -1 });
db.agent_memories.createIndex({ content: 'text' });

db.messages.createIndex({ from_agent: 1, to_agent: 1 });
db.messages.createIndex({ timestamp: -1 });
db.messages.createIndex({ content: 'text' });

db.tasks.createIndex({ workflow_id: 1 });
db.tasks.createIndex({ agent_id: 1 });
db.tasks.createIndex({ status: 1 });
db.tasks.createIndex({ created_at: -1 });

print('MongoDB initialization completed');