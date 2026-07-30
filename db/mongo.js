import mongoose from 'mongoose';

let connected = false;

export async function connectMongo() {
  if (connected) return;
  await mongoose.connect(process.env.MONGO_URI, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
  });
  connected = true;
  console.log('[mongo] connected to', process.env.MONGO_URI);
}

export default mongoose;
