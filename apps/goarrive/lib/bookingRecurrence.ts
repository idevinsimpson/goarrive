export type BookingRecurrence = 'weekly' | 'none';

export function bookingRecurrence(frequency: BookingRecurrence, days: number[]) {
  if (!days.length || (frequency === 'none' && days.length !== 1)) {
    throw new Error('Choose exactly one day for a one-time session.');
  }
  return { repeatFrequency: frequency };
}
