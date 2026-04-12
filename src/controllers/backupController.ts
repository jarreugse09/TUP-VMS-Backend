import { Request, Response } from "express";
import mongoose from "mongoose";
import zlib from "zlib";
import { promisify } from "util";
import BackupLog from "../models/BackupLog";
import { logAction } from "../utils/actionLogger";

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

interface AuthRequest extends Request {
  user?: any;
}

export const downloadBackup = async (req: AuthRequest, res: Response) => {
  try {
    const db = mongoose.connection.db;
    if (!db) {
      return res.status(500).json({ message: "Database connection not available" });
    }

    const collections = await db.listCollections().toArray();
    const backupData: Record<string, any[]> = {};

    for (const collInfo of collections) {
      if (collInfo.name.startsWith("system.")) continue;
      const collection = db.collection(collInfo.name);
      const docs = await collection.find({}).toArray();
      backupData[collInfo.name] = docs;
    }

    const exportObject = {
      exportedAt: new Date(),
      collections: backupData,
    };

    const jsonString = JSON.stringify(exportObject);
    const compressedBuffer = await gzip(jsonString);

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `vms-backup-${timestamp}.json.gz`;

    const log = await BackupLog.create({
      createdBy: req.user.id || req.user._id,
      backupType: "manual",
      fileName,
      sizeBytes: compressedBuffer.length,
      status: "success",
    });

    await logAction(req, "BACKUP_DOWNLOAD", "BackupLog", log._id, `Downloaded backup ${fileName}`);

    res.setHeader("Content-Type", "application/gzip");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    return res.status(200).send(compressedBuffer);
  } catch (err: any) {
    console.error("Backup download error:", err);
    await BackupLog.create({
      createdBy: req.user?.id || req.user?._id || new mongoose.Types.ObjectId(),
      backupType: "manual",
      fileName: "failed-download",
      status: "failed",
    });
    return res.status(500).json({ message: "Backup download failed", error: err.message });
  }
};

export const restoreBackup = async (req: AuthRequest, res: Response) => {
  try {
    const { confirmToken } = req.body;
    
    // Check against RESTORE_CONFIRM_TOKEN
    const expectedToken = process.env.RESTORE_CONFIRM_TOKEN;
    if (!expectedToken || confirmToken !== expectedToken) {
      return res.status(403).json({ message: "Invalid or missing confirm token" });
    }

    if (!req.file) {
      return res.status(400).json({ message: "No backup file provided" });
    }

    const db = mongoose.connection.db;
    if (!db) {
      return res.status(500).json({ message: "Database connection not available" });
    }

    // Decompress and parse
    const uncompressedBuffer = await gunzip(req.file.buffer);
    const jsonString = uncompressedBuffer.toString("utf-8");
    const backupData = JSON.parse(jsonString);

    if (!backupData || !backupData.collections) {
      return res.status(400).json({ message: "Invalid backup format" });
    }

    const collectionNames = Object.keys(backupData.collections);
    let totalDocsRestored = 0;

    for (const collName of collectionNames) {
      if (collName.startsWith("system.")) continue;
      
      const docs = backupData.collections[collName];
      // Convert string _id fields back to ObjectIds if necessary (mongoose handles some of this, but safely mapping string to ObjectId might be needed if generic objects)
      for (const d of docs) {
          if (d._id && typeof d._id === "string" && mongoose.Types.ObjectId.isValid(d._id)) {
              d._id = new mongoose.Types.ObjectId(d._id);
          }
      }

      const collection = db.collection(collName);

      // Drop existing
      try {
        await collection.drop();
      } catch (err: any) {
        // Ignore if collection doesn't exist
        if (err.code !== 26) {
          console.warn(`Could not drop collection ${collName}:`, err);
        }
      }

      // Re-create and insert
      if (docs && docs.length > 0) {
        await collection.insertMany(docs);
        totalDocsRestored += docs.length;
      }
    }

    const log = await BackupLog.create({
      createdBy: req.user.id || req.user._id,
      backupType: "manual",
      fileName: req.file.originalname,
      sizeBytes: req.file.size,
      status: "success",
    });

    await logAction(req, "BACKUP_RESTORE", "BackupLog", log._id, `Restored backup modifying ${collectionNames.length} collections with ${totalDocsRestored} docs`);

    return res.status(200).json({ 
      restored: true, 
      collections: collectionNames.length, 
      documents: totalDocsRestored 
    });

  } catch (err: any) {
    console.error("Backup restore error:", err);
    await BackupLog.create({
        createdBy: req.user?.id || req.user?._id || new mongoose.Types.ObjectId(),
        backupType: "manual",
        fileName: req.file?.originalname || "failed-restore",
        status: "failed",
      });
    return res.status(500).json({ message: "Backup restore failed", error: err.message });
  }
};

export const getBackupLogs = async (req: AuthRequest, res: Response) => {
  try {
    const createdBy = req.user?.id || req.user?._id;
    if (!createdBy) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const logs = await BackupLog.find({ createdBy })
      .sort({ createdAt: -1 })
      .limit(20);

    res.json({ data: logs });
  } catch (error) {
    console.error("Get backup logs error:", error);
    res.status(500).json({ message: "Server error" });
  }
};
