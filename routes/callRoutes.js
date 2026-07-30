import { Router } from 'express';
import { AccessToken } from 'livekit-server-sdk';
import { z } from 'zod';
import { auth } from '../middleware/auth.js';
import { getItem, putItem } from '../db/dynamo.js';

const router = Router();

const LK_API_KEY = () => process.env.LIVEKIT_API_KEY;
const LK_API_SECRET = () => process.env.LIVEKIT_API_SECRET;
const LK_URL = () => process.env.LIVEKIT_URL;
const PUBLIC_LK_URL = () => process.env.PUBLIC_LIVEKIT_URL ?? 'ws://localhost:7880';

const requestSchema = z.object({
  targetType: z.enum(['parent', 'student']).optional(),
  targetId: z.string().optional(),
});

router.post('/request', auth, async (req, res) => {
  const callerRole = req.user.role;
  const callerId = req.user.userId;

  if (callerRole !== 'student' && callerRole !== 'parent') {
    return res.status(403).json({ error: 'forbidden_role' });
  }

  const parsed = requestSchema.safeParse(req.body);
  let targetId = parsed.success && parsed.data.targetId ? parsed.data.targetId : null;

  let studentId = '';
  let parentId = '';

  if (callerRole === 'student') {
    studentId = callerId;
    parentId = targetId || 'p001';
  } else {
    // caller is parent
    parentId = callerId;
    studentId = targetId || 's001';
  }

  const now = new Date().toISOString();
  // Short UUID for direct parent-student call room ID
  const uuid1 = Math.random().toString(36).substring(2, 6);
  const uuid2 = Math.random().toString(36).substring(2, 6);
  const roomName = `call-${uuid1}-${uuid2}`;

  const auditBase = {
    PK: `ROOM#${roomName}`,
    SK: `USER#${callerId}#${Date.now()}`,
    studentId,
    parentId,
    role: callerRole,
    issued_at: now,
    expires_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
  };

  // ConsistentRead: true — enforced inside getItem()
  const relationship = await getItem('student-relationships', {
    PK: `STUDENT#${studentId}`,
    SK: `PARENT#${parentId}`,
  });

  if (!relationship || relationship.status !== 'verified') {
    await putItem('call-tokens-issued', {
      ...auditBase,
      decision: 'denied',
      denial_reason: relationship?.status === 'revoked' ? 'relationship_revoked' : 'no_verified_relationship',
    });
    return res.status(403).json({ error: 'no_verified_relationship' });
  }

  // Mint token: both sides can publish + subscribe for 1:1 call
  const token = new AccessToken(LK_API_KEY(), LK_API_SECRET(), { identity: callerId });
  token.ttl = '4h';
  token.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canPublishData: true,
    canSubscribe: true,
  });
  const jwt = await token.toJwt();

  await putItem('call-tokens-issued', { ...auditBase, decision: 'allowed' });

  return res.json({ token: jwt, roomName, serverUrl: PUBLIC_LK_URL() });
});

export default router;
