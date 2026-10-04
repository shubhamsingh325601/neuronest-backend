/** Plan week for a 1-based day number: days 1–7 → week 1, 8–14 → week 2, … */
export function weekOfDay(dayNumber: number): number {
  return Math.ceil(dayNumber / 7);
}
