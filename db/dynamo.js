import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';

const rawClient = new DynamoDBClient({
  endpoint: process.env.DYNAMODB_ENDPOINT,
  region: process.env.DYNAMODB_REGION,
  credentials: {
    accessKeyId: process.env.DYNAMODB_ACCESS_KEY,
    secretAccessKey: process.env.DYNAMODB_SECRET_KEY,
  },
});

const ddb = DynamoDBDocumentClient.from(rawClient);

/**
 * Always uses ConsistentRead: true — enforced here so no caller can forget.
 */
export async function getItem(TableName, Key) {
  const result = await ddb.send(new GetCommand({ TableName, Key, ConsistentRead: true }));
  return result.Item ?? null;
}

/**
 * Query with ConsistentRead: true.
 */
export async function queryItems(params) {
  const result = await ddb.send(new QueryCommand({ ...params, ConsistentRead: true }));
  return result.Items ?? [];
}

/**
 * Scan with optional filter params and ConsistentRead: true.
 * @param {string} TableName
 * @param {object} [params] — optional ScanCommand extra params (FilterExpression, ExpressionAttributeValues, etc.)
 */
export async function scanItems(TableName, params = {}) {
  const result = await ddb.send(new ScanCommand({ TableName, ConsistentRead: true, ...params }));
  return result.Items ?? [];
}

/**
 * Put an item (audit logs, session state).
 */
export async function putItem(TableName, Item) {
  await ddb.send(new PutCommand({ TableName, Item }));
}

/**
 * Update an item attribute.
 */
export async function updateItem(params) {
  return ddb.send(new UpdateCommand(params));
}

export { ddb };
