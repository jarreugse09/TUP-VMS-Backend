import { v4 as uuidv4 } from "uuid";

export const generateQRString = (role: string): string => {
  const prefix =
    role === "Student" ? "TUPM" : role === "Staff" ? "TUPS" : "TUPV";
  const randomNum1 = Math.floor(Math.random() * 100)
    .toString()
    .padStart(2, "0");
  const randomNum2 = Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, "0");
  return `${prefix}-${randomNum1}-${randomNum2}`;
};

export const generateUniqueId = (): string => {
  return uuidv4();
};
