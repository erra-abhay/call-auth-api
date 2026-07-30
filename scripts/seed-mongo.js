/**
 * seed-mongo.js
 * Seeds the MongoDB users collection with hashed passwords.
 * Run: node scripts/seed-mongo.js
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import * as argon2 from 'argon2';

await mongoose.connect(process.env.MONGO_URI ?? 'mongodb://localhost:27017/optimus');
console.log('[mongo] connected');

const userSchema = new mongoose.Schema(
  { _id: String, role: String, profile: Object, passwordHash: String, device_tokens: [String] },
  { _id: false },
);
const User = mongoose.model('User', userSchema, 'users');

const users = [
  { _id: 's001', role: 'student',  profile: { name: 'Arjun Sharma',  grade: '5' }, password: 'student123' },
  { _id: 'p001', role: 'parent',   profile: { name: 'Priya Sharma'               }, password: 'parent123'  },
  { _id: 'p002', role: 'parent',   profile: { name: 'Rahul Sharma'               }, password: 'parent456'  },
  { _id: 't001', role: 'faculty',  profile: { name: 'Ms. Anita Verma'            }, password: 'faculty123' },
];

for (const u of users) {
  const passwordHash = await argon2.hash(u.password, { type: argon2.argon2id });
  await User.findOneAndUpdate(
    { _id: u._id },
    { _id: u._id, role: u.role, profile: u.profile, passwordHash, device_tokens: [] },
    { upsert: true, new: true },
  );
  console.log(`  [ok] ${u._id} (${u.role}) — password: ${u.password}`);
}

console.log('\n✅ MongoDB users seeded');
await mongoose.disconnect();
