// src/utils/masking.ts

/**
 * Masks a given name, leaving only the first character and replacing the rest with asterisks.
 */
const maskWord = (word?: string) => {
  if (!word || word.length <= 1) return word || "";
  return word[0] + "*".repeat(word.length - 1);
};

export const maskName = (firstName?: string, surname?: string) => {
  const fName = firstName ? maskWord(firstName) : "";
  const lName = surname ? maskWord(surname) : "";
  return `${fName} ${lName}`.trim() || "***";
};

/**
 * Masks a plate number. Uses format ABC-*** if hyphenated; otherwise leaves first 3 chars.
 */
export const maskPlateNumber = (plateNumber?: string) => {
  if (!plateNumber) return plateNumber;
  if (plateNumber.length < 4) return plateNumber;
  const parts = plateNumber.split('-');
  if (parts.length > 1) {
    return `${parts[0]}-***`; 
  }
  return plateNumber.substring(0, 3) + "***";
};
