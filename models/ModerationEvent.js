import mongoose from 'mongoose';

const moderationEventSchema = new mongoose.Schema({
  room_id: { type: String, required: true },
  student_id: { type: String, required: true },
  event_type: { type: String, enum: ['mic_request'], required: true },
  resolved: { type: String, enum: ['approved', 'revoked', null], default: null },
  timestamp: { type: Date, default: Date.now },
});

export const ModerationEvent =
  mongoose.models.ModerationEvent ??
  mongoose.model('ModerationEvent', moderationEventSchema, 'moderation_events');
