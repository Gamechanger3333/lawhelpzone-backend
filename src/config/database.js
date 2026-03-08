import mongoose from "mongoose";
import dns from "dns";
dns.setDefaultResultOrder("ipv4first");

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      dbName: "lawhelpzone",
      serverSelectionTimeoutMS: 10000,
    });

    console.log("✅ MongoDB Connected");
    console.log("Host:", conn.connection.host);
  } catch (err) {
    console.error("❌ MongoDB Connection Error:", err.message);
  }
};

export default connectDB;