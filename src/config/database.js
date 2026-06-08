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
    if (process.env.NODE_ENV !== "production") {
      console.log("Host:", conn.connection.host);
    }
  } catch (err) {
    console.error("❌ MongoDB Connection Error:", err.message);
    process.exit(1);
  }
};

export default connectDB;