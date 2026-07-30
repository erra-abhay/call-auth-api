import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    _id: { type: String }, // e.g. "s001", "p001", "t001"
    role: { type: String, enum: ['student', 'parent', 'faculty'], required: true },
    profile: {
      name: String,
      grade: String,
      avatar_url: String,
    },
    passwordHash: { type: String, required: true },
    device_tokens: [String],
  },
  { _id: false, timestamps: { createdAt: 'created_at', updatedAt: false } },
);

export const User = mongoose.models.User ?? mongoose.model('User', userSchema, 'users');
