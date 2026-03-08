import mongoose from 'mongoose';
import User from './models/User.js';
import Case from './models/Case.js';
import dotenv from 'dotenv';

dotenv.config();

const seedUsers = async () => {
  // Create sample users
};

mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    await seedUsers();
    process.exit(0);
  });