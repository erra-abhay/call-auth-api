import mongoose from 'mongoose';

const callLogSchema = new mongoose.Schema({
  room_id: { type: String, required: true },
  type: { type: String, enum: ['parent_call', 'class_session'], required: true },
  participants: [
    {
      user_id: String,
      role: String,
      joined_at: Date,
      left_at: Date,
    },
  ],
  started_at: Date,
  ended_at: Date,
  quality_stats: {
    avg_bitrate_kbps: Number,
    packet_loss_pct: Number,
  },
});

export const CallLog =
  mongoose.models.CallLog ?? mongoose.model('CallLog', callLogSchema, 'call_logs');
