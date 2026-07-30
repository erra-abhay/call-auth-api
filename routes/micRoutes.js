import { Router } from 'express';
import { z } from 'zod';
import { RoomServiceClient } from 'livekit-server-sdk';
import { auth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { ModerationEvent } from '../models/ModerationEvent.js';

const router = Router();

const LK_API_KEY = () => process.env.LIVEKIT_API_KEY;
const LK_API_SECRET = () => process.env.LIVEKIT_API_SECRET;
const LK_URL = () => process.env.LIVEKIT_URL;

function getRoomService() {
  const httpUrl = LK_URL().replace(/^ws(s?):\/\//, 'http$1://');
  return new RoomServiceClient(httpUrl, LK_API_KEY(), LK_API_SECRET());
}

const micRequestSchema = z.object({
  roomName: z.string().min(1),
  classId: z.string().min(1),
});

const micActionSchema = z.object({
  roomName: z.string().min(1),
  studentIdentity: z.string().min(1),
  eventId: z.string().optional(),
});

/**
 * POST /class/mic-request  (student only)
 * Writes a moderation event and notifies the teacher via LiveKit data channel.
 */
router.post('/mic-request', auth, requireRole('student'), async (req, res) => {
  const parsed = micRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
  }

  const { roomName, classId } = parsed.data;
  const studentId = req.user.userId;

  const event = await ModerationEvent.create({
    room_id: roomName,
    student_id: studentId,
    event_type: 'mic_request',
    resolved: null,
  });

  // Notify teacher via LiveKit data channel
  const payload = JSON.stringify({
    type: 'mic_request',
    studentId,
    roomName,
    eventId: event._id.toString(),
  });

  try {
    const svc = getRoomService();
    await svc.sendData(roomName, Buffer.from(payload), { kind: 1 /* RELIABLE */ });
  } catch {
    // Non-fatal: teacher will poll or receive push
  }

  return res.json({ ok: true, eventId: event._id });
});

/**
 * POST /class/mic-approve  (faculty only)
 * Flips canPublish: true for the student via LiveKit server SDK.
 */
router.post('/mic-approve', auth, requireRole('faculty'), async (req, res) => {
  const parsed = micActionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
  }

  const { roomName, studentIdentity, eventId } = parsed.data;

  await getRoomService().updateParticipant(roomName, studentIdentity, undefined, {
    canPublish: true,
    canPublishData: true,
    canSubscribe: true,
  });

  if (eventId) {
    await ModerationEvent.findByIdAndUpdate(eventId, { resolved: 'approved' });
  }

  return res.json({ ok: true });
});

/**
 * POST /class/mic-revoke  (faculty only)
 * Flips canPublish back to false.
 */
router.post('/mic-revoke', auth, requireRole('faculty'), async (req, res) => {
  const parsed = micActionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
  }

  const { roomName, studentIdentity, eventId } = parsed.data;

  await getRoomService().updateParticipant(roomName, studentIdentity, undefined, {
    canPublish: false,
    canPublishData: true,
    canSubscribe: true,
  });

  if (eventId) {
    await ModerationEvent.findByIdAndUpdate(eventId, { resolved: 'revoked' });
  }

  return res.json({ ok: true });
});

export default router;
