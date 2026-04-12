import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";
import dotenv from "dotenv";

dotenv.config();

const UserSchema = new mongoose.Schema({
  firstName: String,
  surname: String,
  qrCode: String,
  email: String,
});

const User = mongoose.model("User", UserSchema, "users");

async function migrateQRCodes() {
  const uri = process.env.MONGODB_URI || "mongodb://localhost:27017/tupvms";
  
  try {
    await mongoose.connect(uri);
    console.log("Connected to MongoDB");

    const result = await User.updateMany(
      { qrCode: { $exists: false } },
      { $set: { qrCode: uuidv4() } }
    );

    console.log(`Migrated ${result.modifiedCount} users with qrCode`);

    const missingQRCodes = await User.countDocuments({ qrCode: { $exists: false } });
    if (missingQRCodes > 0) {
      console.warn(`${missingQRCodes} users still missing qrCode`);
    } else {
      console.log("All users now have qrCode");
    }

  } catch (error) {
    console.error("Migration failed:", error);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB");
  }
}

migrateQRCodes();
