import { Router } from 'express';
import { z } from 'zod';
import { auth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { getItem, queryItems, scanItems } from '../db/dynamo.js';

const router = Router();

/**
 * GET /student/contacts
 * Returns the authenticated student's verified parent contacts.
 * Only returns { parentId, display_label, status } — no PII.
 */
router.get('/contacts', auth, requireRole('student'), async (req, res) => {
  const studentId = req.user.userId;

  const items = await queryItems({
    TableName: 'student-relationships',
    KeyConditionExpression: 'PK = :pk',
    FilterExpression: '#s = :verified',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: {
      ':pk': `STUDENT#${studentId}`,
      ':verified': 'verified',
    },
  });

  const parents = items.map((item) => ({
    parentId: item.SK.replace('PARENT#', ''),
    display_label: item.display_label ?? item.relation_type ?? 'Parent',
    status: item.status,
  }));

  return res.json({ parents });
});

/**
 * GET /student/classes/today
 * Returns today's scheduled classes and meetings for the authenticated user (student or faculty).
 */
router.get('/classes/today', auth, async (req, res) => {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const userRole = req.user.role;
  const userId = req.user.userId;

  // 1. Fetch all items from class-schedule
  const allSchedules = await scanItems('class-schedule');
  const todaySchedules = allSchedules.filter((item) => {
    // Exclude completed or ended meetings — once ended, they move to session history and leave dashboard
    if (item.is_live === false || item.live_ended_at || item.status === 'completed') {
      return false;
    }
    return (
      item.SK === `SCHEDULE#${today}` ||
      item.SK?.startsWith(`SCHEDULE#${today}`) ||
      item.is_live === true ||
      (item.created_at && item.created_at.startsWith(today))
    );
  });

  const classMap = new Map();

  todaySchedules.forEach((schedule) => {
    const classId = schedule.PK.replace('CLASS#', '');
    classMap.set(classId, {
      classId,
      name: schedule.title || schedule.class_name || 'Class Meeting',
      room_name: schedule.room_name,
      start_time: schedule.start_time || schedule.live_started_at || schedule.created_at,
      end_time: schedule.end_time,
      is_live: schedule.is_live ?? true,
      can_join: true,
      teacher_id: schedule.teacher_id,
    });
  });

  // 2. Also check active enrollments if student
  if (userRole === 'student') {
    const enrollments = await queryItems({
      TableName: 'class-enrollment',
      KeyConditionExpression: 'PK = :pk',
      FilterExpression: '#s = :active',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: {
        ':pk': `STUDENT#${userId}`,
        ':active': 'active',
      },
    });

    for (const enrollment of enrollments) {
      const classId = enrollment.SK.replace('CLASS#', '');
      if (!classMap.has(classId)) {
        const schedule = await getItem('class-schedule', {
          PK: `CLASS#${classId}`,
          SK: `SCHEDULE#${today}`,
        });
        if (schedule) {
          classMap.set(classId, {
            classId,
            name: schedule.title || schedule.class_name || classId,
            room_name: schedule.room_name,
            start_time: schedule.start_time,
            end_time: schedule.end_time,
            is_live: schedule.is_live ?? true,
            can_join: true,
            teacher_id: schedule.teacher_id,
          });
        }
      }
    }
  }

  const classes = Array.from(classMap.values());
  return res.json({ classes });
});

export default router;
