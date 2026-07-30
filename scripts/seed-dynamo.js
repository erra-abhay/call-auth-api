/**
 * seed-dynamo.js
 * Creates all 4 DynamoDB tables and seeds test data for local dev.
 * Run: npm run seed
 */
import 'dotenv/config';
import {
  DynamoDBClient,
  CreateTableCommand,
  DescribeTableCommand,
} from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({
  endpoint: process.env.DYNAMODB_ENDPOINT ?? 'http://localhost:8000',
  region: process.env.DYNAMODB_REGION ?? 'us-east-1',
  credentials: {
    accessKeyId: process.env.DYNAMODB_ACCESS_KEY ?? 'local',
    secretAccessKey: process.env.DYNAMODB_SECRET_KEY ?? 'local',
  },
});
const ddb = DynamoDBDocumentClient.from(client);

// ── Table definitions ──────────────────────────────────────────
const tables = [
  {
    TableName: 'student-relationships',
    AttributeDefinitions: [
      { AttributeName: 'PK', AttributeType: 'S' },
      { AttributeName: 'SK', AttributeType: 'S' },
    ],
    KeySchema: [
      { AttributeName: 'PK', KeyType: 'HASH' },
      { AttributeName: 'SK', KeyType: 'RANGE' },
    ],
    BillingMode: 'PAY_PER_REQUEST',
  },
  {
    TableName: 'class-enrollment',
    AttributeDefinitions: [
      { AttributeName: 'PK', AttributeType: 'S' },
      { AttributeName: 'SK', AttributeType: 'S' },
    ],
    KeySchema: [
      { AttributeName: 'PK', KeyType: 'HASH' },
      { AttributeName: 'SK', KeyType: 'RANGE' },
    ],
    BillingMode: 'PAY_PER_REQUEST',
  },
  {
    TableName: 'class-schedule',
    AttributeDefinitions: [
      { AttributeName: 'PK', AttributeType: 'S' },
      { AttributeName: 'SK', AttributeType: 'S' },
    ],
    KeySchema: [
      { AttributeName: 'PK', KeyType: 'HASH' },
      { AttributeName: 'SK', KeyType: 'RANGE' },
    ],
    BillingMode: 'PAY_PER_REQUEST',
  },
  {
    TableName: 'call-tokens-issued',
    AttributeDefinitions: [
      { AttributeName: 'PK', AttributeType: 'S' },
      { AttributeName: 'SK', AttributeType: 'S' },
    ],
    KeySchema: [
      { AttributeName: 'PK', KeyType: 'HASH' },
      { AttributeName: 'SK', KeyType: 'RANGE' },
    ],
    BillingMode: 'PAY_PER_REQUEST',
  },
];

async function tableExists(name) {
  try {
    await client.send(new DescribeTableCommand({ TableName: name }));
    return true;
  } catch {
    return false;
  }
}

async function createTables() {
  for (const def of tables) {
    if (await tableExists(def.TableName)) {
      console.log(`  [skip] ${def.TableName} already exists`);
    } else {
      await client.send(new CreateTableCommand(def));
      console.log(`  [ok]   ${def.TableName} created`);
    }
  }
}

// ── Seed data ─────────────────────────────────────────────────
const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
const nowIso = new Date().toISOString();
// Schedule: start 30 minutes ago, end 1 hour from now
const startTime = new Date(Date.now() - 30 * 60 * 1000).toISOString();
const endTime = new Date(Date.now() + 60 * 60 * 1000).toISOString();

async function seedData() {
  const items = [
    // ── student-relationships ──────────────────────────────────
    {
      TableName: 'student-relationships',
      Item: {
        PK: 'STUDENT#s001',
        SK: 'PARENT#p001',
        status: 'verified',
        verified_at: '2026-01-10T00:00:00Z',
        relation_type: 'mother',
        display_label: 'Mom',
      },
    },
    {
      TableName: 'student-relationships',
      Item: {
        PK: 'STUDENT#s001',
        SK: 'PARENT#p002',
        status: 'verified',
        verified_at: '2026-01-10T00:00:00Z',
        relation_type: 'father',
        display_label: 'Dad',
      },
    },
    {
      TableName: 'student-relationships',
      Item: {
        PK: 'STUDENT#s001',
        SK: 'PARENT#p099',
        status: 'revoked',
        verified_at: '2026-01-10T00:00:00Z',
        revoked_at: '2026-06-01T00:00:00Z',
        relation_type: 'guardian',
        display_label: 'Guardian',
      },
    },

    // ── class-enrollment ──────────────────────────────────────
    {
      TableName: 'class-enrollment',
      Item: {
        PK: 'STUDENT#s001',
        SK: 'CLASS#c001',
        enrolled_at: '2026-01-15T00:00:00Z',
        status: 'active',
      },
    },
    {
      TableName: 'class-enrollment',
      Item: {
        PK: 'STUDENT#s001',
        SK: 'CLASS#c002',
        enrolled_at: '2026-01-15T00:00:00Z',
        status: 'active',
      },
    },

    // ── class-schedule ────────────────────────────────────────
    {
      TableName: 'class-schedule',
      Item: {
        PK: 'CLASS#c001',
        SK: `SCHEDULE#${today}`,
        teacher_id: 't001',
        class_name: 'Grade 5 Mathematics',
        start_time: startTime,
        end_time: endTime,
        room_name: `class-c001-${today}`,
        grace_period_minutes: 10,
        is_live: false, // faculty must POST /class/start to activate
      },
    },
    {
      TableName: 'class-schedule',
      Item: {
        PK: 'CLASS#c002',
        SK: `SCHEDULE#${today}`,
        teacher_id: 't001',
        class_name: 'Grade 5 Science',
        start_time: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        end_time: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
        room_name: `class-c002-${today}`,
        grace_period_minutes: 10,
        is_live: false,
      },
    },
  ];

  for (const { TableName, Item } of items) {
    await ddb.send(new PutCommand({ TableName, Item }));
    console.log(`  [seed] ${TableName} ← ${Item.PK} / ${Item.SK}`);
  }
}

async function main() {
  console.log('\n── Creating DynamoDB tables ──');
  await createTables();
  console.log('\n── Seeding data ──');
  await seedData();
  console.log('\n✅ Done. Seed users for MongoDB:');
  console.log('   s001 = student (verified parents: p001 Mom, p002 Dad)');
  console.log('   p001, p002 = parents');
  console.log('   t001 = faculty (owns c001 Grade 5 Math, c002 Grade 5 Science)');
  console.log('\n   Create MongoDB users with: node scripts/seed-mongo.js');
}

main().catch((err) => {
  console.error('[seed] FAILED:', err);
  process.exit(1);
});
