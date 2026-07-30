import mongoose from 'mongoose';

const classSchema = new mongoose.Schema(
  {
    _id: { type: String }, // e.g. "c001"
    name: { type: String, required: true },
    teacher_id: { type: String, required: true },
    subject: String,
    roster_size: Number,
  },
  { _id: false },
);

export const Class = mongoose.models.Class ?? mongoose.model('Class', classSchema, 'classes');
