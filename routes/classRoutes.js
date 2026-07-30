import { Router } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { AccessToken } from 'livekit-server-sdk';
import { RoomServiceClient } from 'livekit-server-sdk';
import { auth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { getItem, putItem, updateItem } from '../db/dynamo.js';

const router = Router();

const LK_API_KEY = () => process.env.LIVEKIT_API_KEY;
const LK_API_SECRET = () => process.env.LIVEKIT_API_SECRET;
const LK_URL = () => process.env.LIVEKIT_URL;
const PUBLIC_LK_URL = () => process.env.PUBLIC_LIVEKIT_URL ?? 'ws://localhost:7880';

/**
 * Stores a LiveKit token server-side and returns a short opaque join code.
 * The join code is safe to put in the URL — it reveals nothing about the token or room.
 * TTL: 4 hours (stored as expiresAt ISO string; caller must enforce)
 */
async function storeJoinSession(jwt, roomName, serverUrl, meta = {}) {
  const raw = randomUUID().replace(/-/g, '');
  // Format: xxx-xxxx-xxx  (3-4-3 alphanumeric, similar to Google Meet)
  const joinCode = `${raw.slice(0, 3)}-${raw.slice(3, 7)}-${raw.slice(7, 10)}`;
  const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
  await putItem('join-sessions', {
    PK: `JOIN#${joinCode}`,
    SK: 'META',
    token: jwt,
    roomName,
    serverUrl,
    creatorId: meta.creatorId || meta.teacherId || '',
    meta,          // { role, isHost, classId } — sent back to client for PeoplePanel
    expiresAt,
    createdAt: new Date().toISOString(),
  });
  return joinCode;
}

function getRoomService() {
  // Convert ws:// to http:// for the REST API
  const httpUrl = LK_URL().replace(/^ws(s?):\/\//, 'http$1://');
  return new RoomServiceClient(httpUrl, LK_API_KEY(), LK_API_SECRET());
}

const startSchema = z.object({
  classId: z.string().optional(),
  date: z.string().optional(),
  title: z.string().optional(),
  branch: z.string().optional(),
  section: z.string().optional(),
  gradeClass: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  isInstant: z.boolean().optional(),
});

const joinSchema = z.object({
  classId: z.string().min(1),
});

/**
 * GET /class/status?classId=c001&date=2026-07-30
 * Returns whether a session is currently live.
 */
router.get('/status', auth, async (req, res) => {
  const { classId, date } = req.query;
  if (!classId) return res.status(400).json({ error: 'classId required' });
  const today = date ?? new Date().toISOString().slice(0, 10);

  const schedule = await getItem('class-schedule', {
    PK: `CLASS#${classId}`,
    SK: `SCHEDULE#${today}`,
  });

  if (!schedule) return res.status(404).json({ error: 'no_schedule' });

  return res.json({
    classId,
    is_live: schedule.is_live ?? false,
    room_name: schedule.room_name,
    start_time: schedule.start_time,
    end_time: schedule.end_time,
  });
});

/**
 * POST /class/start  (faculty only)
 * Activates a pre-scheduled or dynamic new session and issues the teacher's token.
 */
router.post('/start', auth, requireRole('faculty'), async (req, res) => {
  const teacherId = req.user.userId;
  const now = new Date().toISOString();
  const todayDate = new Date().toISOString().slice(0, 10);

  const classId = req.body?.classId || 'c001';
  const date = (req.body?.date && req.body.date.match(/^\d{4}-\d{2}-\d{2}$/)) ? req.body.date : todayDate;

  let schedule = await getItem('class-schedule', {
    PK: `CLASS#${classId}`,
    SK: `SCHEDULE#${date}`,
  });

  let roomName = '';
  if (!schedule) {
    const rawUuid = randomUUID().replace(/-/g, '');
    roomName = `meet-${rawUuid.slice(0, 3)}-${rawUuid.slice(3, 7)}-${rawUuid.slice(7, 10)}`;
    schedule = {
      PK: `CLASS#${classId}`,
      SK: `SCHEDULE#${date}`,
      title: req.body?.title || 'Class Session',
      teacher_id: teacherId,
      room_name: roomName,
      is_live: true,
      live_started_at: now,
      created_at: now,
    };
    await putItem('class-schedule', schedule);
  } else {
    roomName = schedule.room_name;
    await updateItem({
      TableName: 'class-schedule',
      Key: { PK: `CLASS#${classId}`, SK: `SCHEDULE#${date}` },
      UpdateExpression: 'SET is_live = :live, live_started_at = :ts',
      ExpressionAttributeValues: { ':live': true, ':ts': now },
    });
  }

  // Mint teacher token: full publish + subscribe + room admin
  // metadata is embedded in the JWT so the client can read isHost without extra API calls
  const teacherName = req.user.name || teacherId;
  const token = new AccessToken(LK_API_KEY(), LK_API_SECRET(), {
    identity: teacherId,
    name: teacherName,
    metadata: JSON.stringify({ role: 'faculty', isHost: true, classId }),
  });
  token.ttl = '4h';
  token.addGrant({
    room: roomName,
    roomJoin: true,
    roomAdmin: true,
    canPublish: true,
    canPublishData: true,
    canSubscribe: true,
  });
  const jwt = await token.toJwt();

  // Audit log
  await putItem('call-tokens-issued', {
    PK: `ROOM#${roomName}`,
    SK: `USER#${teacherId}#${Date.now()}`,
    role: 'faculty',
    issued_at: now,
    expires_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
    decision: 'allowed',
  });

  // Store token server-side — return opaque join code (not the raw JWT)
  const joinCode = await storeJoinSession(jwt, roomName, PUBLIC_LK_URL(), { classId, role: 'faculty', isHost: true });
  return res.json({ joinCode, roomName, serverUrl: PUBLIC_LK_URL() });
});

/**
 * Helper to record session completion across class-schedule and meeting-history
 */
async function recordSessionEnd(scheduleKey, schedule, userId) {
  const now = new Date().toISOString();
  const classId = schedule.class_id || schedule.PK?.replace('CLASS#', '') || `c_${Date.now()}`;
  const teacherId = schedule.teacher_id || userId;
  const todayDate = schedule.SK?.replace('SCHEDULE#', '') || now.slice(0, 10);
  const title = schedule.class_name || schedule.title || 'Class Meeting';

  // Mark completed in class-schedule
  await updateItem({
    TableName: 'class-schedule',
    Key: scheduleKey,
    UpdateExpression: 'SET is_live = :live, live_ended_at = :ts, #st = :status',
    ExpressionAttributeNames: { '#st': 'status' },
    ExpressionAttributeValues: { ':live': false, ':ts': now, ':status': 'completed' },
  }).catch(() => {});

  const sessionId = `${classId}-${Date.now()}`;

  // 1. Log class record
  await putItem('meeting-history', {
    PK: `CLASS#${classId}`,
    SK: `SESSION#${sessionId}`,
    session_id: sessionId,
    class_id: classId,
    class_name: title,
    teacher_id: teacherId,
    room_name: schedule.room_name || '',
    started_at: schedule.live_started_at || schedule.created_at || now,
    ended_at: now,
    date: todayDate,
    branch: schedule.branch || 'Main Campus',
    section: schedule.section || 'Sec A',
    grade_class: schedule.grade_class || 'Grade 5',
    type: 'class',
  });

  // 2. Log teacher history record
  await putItem('meeting-history', {
    PK: `TEACHER#${teacherId}`,
    SK: `SESSION#${sessionId}`,
    session_id: sessionId,
    class_id: classId,
    class_name: title,
    teacher_id: teacherId,
    room_name: schedule.room_name || '',
    started_at: schedule.live_started_at || schedule.created_at || now,
    ended_at: now,
    date: todayDate,
    branch: schedule.branch || 'Main Campus',
    section: schedule.section || 'Sec A',
    grade_class: schedule.grade_class || 'Grade 5',
    type: 'class',
  });

  // 3. Log for all students enrolled or default s001
  try {
    const enrollments = await scanItems('class-enrollment');
    const classEnrollments = enrollments.filter(e => e.SK === `CLASS#${classId}`);
    const studentIds = new Set(classEnrollments.map(e => e.PK.replace('STUDENT#', '')));
    studentIds.add('s001'); // Ensure s001 gets student history entry

    for (const studentId of studentIds) {
      await putItem('meeting-history', {
        PK: `STUDENT#${studentId}`,
        SK: `SESSION#${sessionId}`,
        session_id: sessionId,
        class_id: classId,
        class_name: title,
        teacher_id: teacherId,
        started_at: schedule.live_started_at || schedule.created_at || now,
        joined_at: schedule.live_started_at || schedule.created_at || now,
        ended_at: now,
        left_at: now,
        date: todayDate,
        type: 'class',
      });
    }
  } catch (err) {
    console.error('Failed writing student meeting history', err);
  }

  return sessionId;
}

/**
 * POST /class/end  (faculty only)
 * Ends a live session, deletes the LiveKit room (kicks all), and logs to meeting-history.
 */
router.post('/end', auth, requireRole('faculty'), async (req, res) => {
  const parsed = startSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
  }

  const { classId, date } = parsed.data;
  const teacherId = req.user.userId;
  const todayDate = date ?? new Date().toISOString().slice(0, 10);

  const schedule = await getItem('class-schedule', {
    PK: `CLASS#${classId}`,
    SK: `SCHEDULE#${todayDate}`,
  });

  if (!schedule) return res.status(404).json({ error: 'no_schedule' });
  if (schedule.teacher_id !== teacherId) return res.status(403).json({ error: 'not_your_class' });

  // Delete LiveKit room (kicks all participants)
  try {
    await getRoomService().deleteRoom(schedule.room_name);
  } catch {
    // Room may already be empty/deleted — not fatal
  }

  const sessionId = await recordSessionEnd({ PK: `CLASS#${classId}`, SK: `SCHEDULE#${todayDate}` }, schedule, teacherId);

  return res.json({ ok: true, sessionId });
});

/**
 * POST /class/end-room  (any authenticated user on room disconnect/leave)
 * Resolves schedule by roomName, realRoomName, or classId, updates status to completed, and writes meeting-history.
 */
router.post('/end-room', auth, async (req, res) => {
  const { roomName, realRoomName, classId } = req.body || {};
  if (!roomName && !realRoomName && !classId) return res.status(400).json({ error: 'room_identifier_required' });

  try {
    const targetLkRoom = realRoomName || roomName;
    if (targetLkRoom) await getRoomService().deleteRoom(targetLkRoom);
  } catch {}

  const now = new Date().toISOString();
  const userId = req.user.userId;

  let targetClassId = classId;
  let targetLkRoom = realRoomName;

  // Resolve joinCode in join-sessions table if roomName provided
  if (roomName) {
    const joinSession = await getItem('join-sessions', { PK: `JOIN#${roomName}`, SK: 'META' });
    if (joinSession) {
      if (joinSession.roomName) targetLkRoom = joinSession.roomName;
      if (joinSession.meta?.classId) targetClassId = joinSession.meta.classId;
    }
  }

  const allSchedules = await scanItems('class-schedule');
  let schedule = allSchedules.find(s =>
    (targetClassId && s.PK === `CLASS#${targetClassId}`) ||
    (targetLkRoom && (s.room_name === targetLkRoom || s.roomName === targetLkRoom)) ||
    (roomName && (s.room_name === roomName || s.roomName === roomName || s.PK === `CLASS#${roomName}`))
  );

  let scheduleKey;
  if (schedule) {
    scheduleKey = { PK: schedule.PK, SK: schedule.SK };
  } else {
    // Ad-hoc / instant meeting schedule fallback
    const cid = targetClassId || classId || roomName || `c_${Date.now()}`;
    const today = now.slice(0, 10);
    scheduleKey = { PK: `CLASS#${cid}`, SK: `SCHEDULE#${today}` };
    schedule = {
      PK: `CLASS#${cid}`,
      SK: `SCHEDULE#${today}`,
      class_id: cid,
      class_name: 'Class Meeting',
      teacher_id: userId,
      room_name: targetLkRoom || roomName,
      created_at: now,
      live_started_at: now,
    };
  }

  const sessionId = await recordSessionEnd(scheduleKey, schedule, userId);

  return res.json({ ok: true, sessionId });
});

/**
 * POST /class/join  (student only)
 * Issues a student token with canPublish: false (default closed).
 * - If the class is currently live (is_live=true), any authenticated student can join.
 * - If not live, the student must be enrolled to join.
 */
router.post('/join', auth, requireRole('student'), async (req, res) => {
  const parsed = joinSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
  }

  const { classId } = parsed.data;
  const studentId = req.user.userId;
  const today = new Date().toISOString().slice(0, 10);
  const now = Date.now();

  const auditBase = {
    PK: `ROOM#class-${classId}-${today}`,
    SK: `USER#${studentId}#${Date.now()}`,
    role: 'student',
    issued_at: new Date().toISOString(),
    expires_at: new Date(now + 4 * 60 * 60 * 1000).toISOString(),
  };

  // First fetch the schedule to check live status
  const schedule = await getItem('class-schedule', {
    PK: `CLASS#${classId}`,
    SK: `SCHEDULE#${today}`,
  });

  if (!schedule) {
    await putItem('call-tokens-issued', { ...auditBase, decision: 'denied', denial_reason: 'no_schedule' });
    return res.status(403).json({ error: 'no_schedule' });
  }

  if (!schedule.is_live) {
    // Not live yet — require enrollment
    const enrollment = await getItem('class-enrollment', {
      PK: `STUDENT#${studentId}`,
      SK: `CLASS#${classId}`,
    });
    if (!enrollment || enrollment.status !== 'active') {
      await putItem('call-tokens-issued', { ...auditBase, decision: 'denied', denial_reason: 'not_enrolled' });
      return res.status(403).json({ error: 'not_enrolled' });
    }
    await putItem('call-tokens-issued', { ...auditBase, decision: 'denied', denial_reason: 'session_not_live' });
    return res.status(403).json({ error: 'session_not_live' });
  }

  // Class is live — check time window only if end_time is set
  if (schedule.start_time && schedule.end_time) {
    const grace = (schedule.grace_period_minutes ?? 10) * 60 * 1000;
    const start = new Date(schedule.start_time).getTime();
    const end = new Date(schedule.end_time).getTime();
    if (now < start - grace || now > end + grace) {
      await putItem('call-tokens-issued', { ...auditBase, decision: 'denied', denial_reason: 'outside_schedule_window' });
      return res.status(403).json({ error: 'outside_schedule_window' });
    }
  }

  // Class is live — any authenticated student can join
  const roomName = schedule.room_name;
  const studentName = req.user.name || studentId;
  const token = new AccessToken(LK_API_KEY(), LK_API_SECRET(), {
    identity: studentId,
    name: studentName,
    metadata: JSON.stringify({ role: 'student', isHost: false, classId }),
  });
  token.ttl = '4h';
  token.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true,     // students CAN publish camera/mic — they join with UI defaults off
    canPublishData: true, // allow data channel (chat, mic requests)
    canSubscribe: true,
  });
  const jwt = await token.toJwt();

  await putItem('call-tokens-issued', { ...auditBase, decision: 'allowed' });

  // Store token server-side — return opaque join code (not the raw JWT)
  const joinCode = await storeJoinSession(jwt, roomName, PUBLIC_LK_URL(), { classId, role: 'student', isHost: false });
  return res.json({ joinCode, roomName, serverUrl: PUBLIC_LK_URL() });
});

/**
 * GET /class/token?code=abc-defg-xyz
 * Exchanges an opaque join code for the real LiveKit token.
 * Requires a valid session (auth cookie). The join code is single-use-friendly and short-lived.
 */
router.get('/token', auth, async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).json({ error: 'code_required' });

  const session = await getItem('join-sessions', {
    PK: `JOIN#${code}`,
    SK: 'META',
  });

  if (!session) return res.status(404).json({ error: 'invalid_code' });

  // Check expiry
  if (new Date(session.expiresAt) < new Date()) {
    return res.status(403).json({ error: 'code_expired' });
  }

  const userId = req.user.userId;
  const userRole = req.user.role || 'student';
  const userName = req.user.name || userId;

  const creatorId = session.creatorId || session.meta?.creatorId || session.meta?.teacherId;
  const isHost = userRole === 'faculty' || (creatorId && creatorId === userId) || session.meta?.isHost === true;

  const roomName = session.roomName;
  const classId = session.meta?.classId || '';

  // Mint a personalized token for THIS requesting user (NOT the creator's raw token)
  const token = new AccessToken(LK_API_KEY(), LK_API_SECRET(), {
    identity: userId,
    name: userName,
    metadata: JSON.stringify({ role: userRole, isHost, classId }),
  });
  token.ttl = '4h';
  token.addGrant({
    room: roomName,
    roomJoin: true,
    roomAdmin: isHost,
    canPublish: true,
    canPublishData: true,
    canSubscribe: true,
  });
  const userJwt = await token.toJwt();

  const userMeta = {
    role: userRole,
    isHost,
    classId,
  };

  return res.json({
    token: userJwt,
    roomName: session.roomName,
    serverUrl: session.serverUrl || PUBLIC_LK_URL(),
    meta: userMeta,
  });
});

/**
 * GET /class/status?joinCode=abc-defg-xyz
 * Returns whether the class linked to a join code is currently live.
 * Used by students polling the "Waiting for host" screen.
 */
router.get('/status', auth, async (req, res) => {
  const { joinCode, classId } = req.query;

  // Resolve classId from joinCode if not provided directly
  let resolvedClassId = classId;
  if (!resolvedClassId && joinCode) {
    const session = await getItem('join-sessions', { PK: `JOIN#${joinCode}`, SK: 'META' });
    if (session?.meta?.classId) resolvedClassId = session.meta.classId;
    else return res.status(404).json({ error: 'invalid_code' });
  }
  if (!resolvedClassId) return res.status(400).json({ error: 'classId_or_joinCode_required' });

  const today = new Date().toISOString().slice(0, 10);
  const schedule = await getItem('class-schedule', {
    PK: `CLASS#${resolvedClassId}`,
    SK: `SCHEDULE#${today}`,
  });

  if (!schedule) return res.status(404).json({ error: 'no_schedule' });

  return res.json({
    classId: resolvedClassId,
    is_live: schedule.is_live ?? false,
    class_name: schedule.class_name || schedule.title || '',
    teacher_id: schedule.teacher_id,
  });
});

/**
 * POST /class/log  (any authenticated user)
 * Logs participant join/leave events for history.
 * Body: { sessionId, classId, eventType: 'join'|'leave', timestamp }
 */
router.post('/log', auth, async (req, res) => {
  const { sessionId, classId, eventType, timestamp } = req.body || {};
  if (!eventType) return res.status(400).json({ error: 'eventType_required' });

  const userId = req.user.userId;
  const now = timestamp || new Date().toISOString();
  const sid = sessionId || `${classId || 'unknown'}-${Date.now()}`;

  await putItem('participant-events', {
    PK: `SESSION#${sid}`,
    SK: `USER#${userId}#${Date.now()}`,
    user_id: userId,
    user_name: req.user.name || userId,
    role: req.user.role || 'student',
    class_id: classId || '',
    event_type: eventType,
    timestamp: now,
  });

  // For student history: also log a row per-student
  if (eventType === 'join') {
    await putItem('meeting-history', {
      PK: `STUDENT#${userId}`,
      SK: `ATTEND#${sid}#${Date.now()}`,
      session_id: sid,
      class_id: classId || '',
      event_type: 'join',
      joined_at: now,
      type: 'class',
    });
  } else if (eventType === 'leave') {
    await putItem('meeting-history', {
      PK: `STUDENT#${userId}`,
      SK: `ATTEND#${sid}#${Date.now()}`,
      session_id: sid,
      class_id: classId || '',
      event_type: 'leave',
      left_at: now,
      type: 'class',
    });
  }

  return res.json({ ok: true });
});

/**
 * POST /class/create (faculty only)
 * Creates or schedules a new class meeting for a specific branch, section, and grade/class.
 */
const createSchema = z.object({
  title: z.string().min(1),
  branch: z.string().optional().default('Main Campus'),
  section: z.string().optional().default('Section A'),
  gradeClass: z.string().optional().default('Grade 5'),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  isInstant: z.boolean().optional(),
});

router.post('/create', auth, requireRole('faculty'), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
  }

  const { title, branch, section, gradeClass, startTime, endTime, isInstant } = parsed.data;
  const teacherId = req.user.userId;
  const today = new Date().toISOString().slice(0, 10);
  const classId = `c_${Date.now()}`;
  const rawUuid = randomUUID().replace(/-/g, '');
  const roomName = `meet-${rawUuid.slice(0, 3)}-${rawUuid.slice(3, 7)}-${rawUuid.slice(7, 10)}`;

  const nowISO = new Date().toISOString();
  const startISO = startTime ? new Date(startTime).toISOString() : nowISO;
  const endISO = endTime ? new Date(endTime).toISOString() : new Date(Date.now() + 60 * 60 * 1000).toISOString();

  const scheduleItem = {
    PK: `CLASS#${classId}`,
    SK: `SCHEDULE#${today}`,
    class_id: classId,
    class_name: title,
    branch,
    section,
    grade_class: gradeClass,
    room_name: roomName,
    teacher_id: teacherId,
    start_time: startISO,
    end_time: endISO,
    is_live: isInstant === true,
    live_started_at: isInstant ? nowISO : null,
    grace_period_minutes: 10,
  };

  await putItem('class-schedule', scheduleItem);

  // Auto-create active enrollment for all students (broad access for now)
  await putItem('class-enrollment', {
    PK: `STUDENT#s001`,
    SK: `CLASS#${classId}`,
    status: 'active',
    enrolled_at: nowISO,
  });

  // If instant meeting, issue teacher token right away
  if (isInstant) {
    const tName = req.user?.name || teacherId;
    const token = new AccessToken(LK_API_KEY(), LK_API_SECRET(), {
      identity: teacherId,
      name: tName,
      metadata: JSON.stringify({ role: 'faculty', isHost: true, classId }),
    });
    token.ttl = '4h';
    token.addGrant({
      room: roomName,
      roomJoin: true,
      roomAdmin: true,
      canPublish: true,
      canPublishData: true,
      canSubscribe: true,
    });
    const jwt = await token.toJwt();
    const joinCode = await storeJoinSession(jwt, roomName, PUBLIC_LK_URL(), { classId, role: 'faculty', isHost: true });
    return res.json({ classId, roomName, joinCode, serverUrl: PUBLIC_LK_URL(), is_live: true });
  }

  return res.json({ classId, roomName, is_live: false, message: 'Class meeting scheduled successfully' });
});

/**
 * GET /history/me  (any authenticated user)
 * Returns meeting/call history for the currently logged-in user (role-aware).
 */
router.get('/history/me', auth, async (req, res) => {
  const userId = req.user.userId;
  const role = req.user.role;
  const { scanItems } = await import('../db/dynamo.js');

  if (role === 'faculty') {
    // Return all sessions this teacher created
    const items = await scanItems('meeting-history', {
      FilterExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': `TEACHER#${userId}` },
    });
    return res.json({ sessions: items || [], role: 'faculty' });
  }

  if (role === 'student') {
    // Return attendance events for this student
    const items = await scanItems('meeting-history', {
      FilterExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': `STUDENT#${userId}` },
    });
    return res.json({ sessions: items || [], role: 'student' });
  }

  if (role === 'parent') {
    const items = await scanItems('meeting-history', {
      FilterExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': `PARENT#${userId}` },
    });
    return res.json({ sessions: items || [], role: 'parent' });
  }

  return res.json({ sessions: [], role });
});

/**
 * POST /class/kick  (faculty only)
 * Removes a participant from a LiveKit room using RoomService.removeParticipant.
 * Body: { roomName, identity }
 */
router.post('/kick', auth, requireRole('faculty'), async (req, res) => {
  const { roomName, identity } = req.body || {};
  if (!roomName || !identity) return res.status(400).json({ error: 'roomName_and_identity_required' });
  try {
    let realRoomName = roomName;
    // Look up joinCode in join-sessions table
    const session = await getItem('join-sessions', { PK: `JOIN#${roomName}`, SK: 'META' });
    if (session && session.roomName) {
      realRoomName = session.roomName;
    } else {
      // Look up schedule by room_name
      const allSchedules = await scanItems('class-schedule');
      const sched = allSchedules.find(s => s.room_name === roomName || s.roomName === roomName);
      if (sched && sched.room_name) realRoomName = sched.room_name;
    }
    await getRoomService().removeParticipant(realRoomName, identity);
    return res.json({ ok: true, realRoomName });
  } catch (err) {
    console.error('[kick] error:', err);
    return res.status(500).json({ error: 'kick_failed', detail: err?.message });
  }
});

export default router;
