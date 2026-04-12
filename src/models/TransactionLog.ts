import mongoose, { Document, Schema } from "mongoose";

export interface ITransactionLog extends Document {
  _id: mongoose.Types.ObjectId;
  clientId: mongoose.Types.ObjectId;
  staffId: mongoose.Types.ObjectId;
  transactionStart: Date;
  transactionEnd?: Date | null;
  transactionType: string;
  scannedBy?: string;
  notes?: string | null;
  collegeId?: mongoose.Types.ObjectId;
  departmentId?: mongoose.Types.ObjectId;
}

const TransactionLogSchema: Schema = new Schema({
  clientId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  staffId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  transactionStart: { type: Date, required: true },
  transactionEnd: { type: Date, default: null },
  transactionType: { type: String, required: true },
  scannedBy: { type: String, default: "self" },
  notes: { type: String, default: null },
  collegeId: { type: Schema.Types.ObjectId, ref: "College", default: null },
  departmentId: { type: Schema.Types.ObjectId, ref: "Department", default: null },
}, { timestamps: true });

TransactionLogSchema.index({ clientId: 1, transactionStart: -1 });
TransactionLogSchema.index({ staffId: 1, transactionStart: -1 });
TransactionLogSchema.index({ collegeId: 1, transactionStart: -1 });
TransactionLogSchema.index({ departmentId: 1, transactionStart: -1 });

export default mongoose.model<ITransactionLog>("TransactionLog", TransactionLogSchema);
