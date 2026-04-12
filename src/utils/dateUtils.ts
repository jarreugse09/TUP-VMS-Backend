/**
 * Returns the current date/time normalized to Asia/Manila (PHT)
 * This ensures all transaction and attendance logs are consistently 
 * recorded in Philippine time regardless of server environment.
 */
export const getManilaTime = (): Date => {
  // Use Intl.DateTimeFormat to compute the current PHT time
  // This approach is robust and doesn't require extra heavy libraries
  const now = new Date();
  
  // Format as US string in Manila timezone
  const manilaString = now.toLocaleString("en-US", {
    timeZone: "Asia/Manila",
    hour12: false,
  });

  // Re-parse into a Date object
  // Note: the resulting Date object's internal UTC value will represent 
  // the 'local' human-readable time in Manila.
  return new Date(manilaString);
};

/**
 * Returns the start of the day (00:00:00) in Manila time
 */
export const getManilaStartOfDay = (date?: Date): Date => {
  const d = date ? new Date(date) : getManilaTime();
  d.setHours(0, 0, 0, 0);
  return d;
};
