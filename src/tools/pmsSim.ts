/**
 * PMSSim — deterministic Property Management System simulator.
 *
 * Tools exposed:
 *   find_reservation     — search by guest name and/or confirmation code
 *   check_in             — mark guest as checked-in, return room details
 *   check_out            — mark guest as checked-out
 *   check_availability   — return available room types/prices for date range
 *   create_reservation   — create a new walk-in reservation (in-memory)
 *
 * Reservations are seeded from src/data/reservations.json at startup.
 */

import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';

// ── Room inventory (static) ────────────────────────────────────────────────────

const ROOM_INVENTORY = [
  { type: 'Standard Single', pricePerNight: 120, totalRooms: 15, maxGuests: 2 },
  { type: 'Deluxe Double',   pricePerNight: 180, totalRooms: 20, maxGuests: 2 },
  { type: 'Junior Suite',    pricePerNight: 280, totalRooms:  8, maxGuests: 3 },
  { type: 'Family Room',     pricePerNight: 250, totalRooms:  6, maxGuests: 4 },
  { type: 'Penthouse Suite', pricePerNight: 600, totalRooms:  2, maxGuests: 4 },
];

// ── Types ──────────────────────────────────────────────────────────────────────

interface Reservation {
  reservationId: string;
  confirmationCode: string;
  guestName: string;
  roomNumber: string;
  roomType: string;
  checkInDate: string;
  checkOutDate: string;
  status: 'confirmed' | 'checked-in' | 'checked-out';
  guests: number;
  breakfastIncluded: boolean;
}

// ── Data ───────────────────────────────────────────────────────────────────────

const reservationsPath = path.resolve(__dirname, '..', 'data', 'reservations.json');

let reservations: Reservation[] = [];
try {
  const raw = fs.readFileSync(reservationsPath, 'utf-8');
  reservations = JSON.parse(raw) as Reservation[];
} catch (err) {
  console.error('[pmsSim] Failed to load reservations.json:', err);
}

let _walkInSeq = 100; // generates WALK-101, WALK-102, …

// ── Tool schemas ───────────────────────────────────────────────────────────────

export const FindReservationSchema = z.object({
  name: z.string().describe("Guest's last name or full name"),
  confirmationCode: z
    .string()
    .optional()
    .describe('Booking confirmation code (e.g. CONF001) — optional but speeds up lookup'),
});

export type FindReservationArgs = z.infer<typeof FindReservationSchema>;

export const CheckInSchema = z.object({
  reservationId: z.string().describe('Reservation ID from find_reservation result'),
  idVerified: z
    .boolean()
    .describe('Set to true only after the guest has physically presented a valid photo ID'),
});

export type CheckInArgs = z.infer<typeof CheckInSchema>;

export const CheckOutSchema = z.object({
  reservationId: z.string().describe('Reservation ID from find_reservation result'),
});

export type CheckOutArgs = z.infer<typeof CheckOutSchema>;

export const CheckAvailabilitySchema = z.object({
  checkInDate:  z.string().describe('Check-in date in YYYY-MM-DD format'),
  checkOutDate: z.string().describe('Check-out date in YYYY-MM-DD format'),
  roomType: z.string().optional().describe('Preferred room type keyword (optional, e.g. "suite")'),
  guests:   z.number().int().min(1).optional().describe('Number of guests (optional)'),
});

export type CheckAvailabilityArgs = z.infer<typeof CheckAvailabilitySchema>;

export const CreateReservationSchema = z.object({
  guestName:    z.string().describe("Guest's full name — first and last name required"),
  checkInDate:  z.string().describe('Check-in date in YYYY-MM-DD format'),
  checkOutDate: z.string().describe('Check-out date in YYYY-MM-DD format'),
  roomType:     z.string().describe('Exact room type from check_availability result'),
  guests:       z.number().int().min(1).describe('Number of guests'),
  contact:      z.string().describe('Guest contact — phone number or email address'),
});

export type CreateReservationArgs = z.infer<typeof CreateReservationSchema>;

// ── Implementations ────────────────────────────────────────────────────────────

export async function findReservation(args: FindReservationArgs): Promise<unknown> {
  const nameLower = args.name.toLowerCase().trim();

  const matches = reservations.filter((r) => {
    const nameMatch = r.guestName.toLowerCase().includes(nameLower);
    const codeMatch = args.confirmationCode
      ? r.confirmationCode.toUpperCase() === args.confirmationCode.toUpperCase()
      : true;
    return nameMatch && codeMatch;
  });

  if (matches.length === 0) {
    return {
      matches: [],
      message:
        'No reservation found. Please double-check the name or confirmation code and try again.',
    };
  }

  return {
    matches: matches.map((r) => ({
      reservationId: r.reservationId,
      confirmationCode: r.confirmationCode,
      guestName: r.guestName,
      roomNumber: r.roomNumber,
      roomType: r.roomType,
      checkInDate: r.checkInDate,
      checkOutDate: r.checkOutDate,
      status: r.status,
      guests: r.guests,
      breakfastIncluded: r.breakfastIncluded,
    })),
  };
}

export async function checkIn(args: CheckInArgs): Promise<unknown> {
  if (!args.idVerified) {
    return {
      error:
        'ID verification is required before check-in. Please ask the guest to present a valid government-issued photo ID.',
    };
  }

  const reservation = reservations.find((r) => r.reservationId === args.reservationId);
  if (!reservation) {
    return { error: `Reservation "${args.reservationId}" not found.` };
  }

  if (reservation.status === 'checked-in') {
    return {
      status: 'already_checked_in',
      roomNumber: reservation.roomNumber,
      message: `${reservation.guestName} is already checked in to room ${reservation.roomNumber}.`,
    };
  }

  if (reservation.status === 'checked-out') {
    return { error: 'This reservation has already been checked out.' };
  }

  // Mutate in-memory record
  reservation.status = 'checked-in';

  return {
    status: 'success',
    roomNumber: reservation.roomNumber,
    roomType: reservation.roomType,
    guestName: reservation.guestName,
    checkOutDate: reservation.checkOutDate,
    breakfastIncluded: reservation.breakfastIncluded,
    breakfastHours: reservation.breakfastIncluded ? '07:00–10:30, Restaurant Agora (Ground Floor)' : null,
    wifiNetwork: 'AthenaGrand_Guest',
    wifiPassword: 'Welcome2024',
    message: `Welcome, ${reservation.guestName}! Your room ${reservation.roomNumber} is ready. Enjoy your stay.`,
  };
}

export async function checkOut(args: CheckOutArgs): Promise<unknown> {
  const reservation = reservations.find((r) => r.reservationId === args.reservationId);
  if (!reservation) {
    return { error: `Reservation "${args.reservationId}" not found.` };
  }

  if (reservation.status !== 'checked-in') {
    return {
      error: `Cannot check out: current reservation status is "${reservation.status}". Guest must be checked in first.`,
    };
  }

  reservation.status = 'checked-out';

  return {
    status: 'success',
    guestName: reservation.guestName,
    roomNumber: reservation.roomNumber,
    checkoutTime: new Date().toISOString(),
    message: `Thank you for staying with us, ${reservation.guestName}! We hope to welcome you back soon. Safe travels!`,
  };
}

export async function checkAvailability(args: CheckAvailabilityArgs): Promise<unknown> {
  const checkIn  = new Date(args.checkInDate);
  const checkOut = new Date(args.checkOutDate);

  if (isNaN(checkIn.getTime()) || isNaN(checkOut.getTime())) {
    return { error: 'Invalid date format. Use YYYY-MM-DD.' };
  }
  const nights = Math.round((checkOut.getTime() - checkIn.getTime()) / 86_400_000);
  if (nights <= 0) {
    return { error: 'Check-out date must be after check-in date.' };
  }

  // Count rooms per type already occupied in the requested window
  const occupiedByType: Record<string, number> = {};
  for (const r of reservations) {
    if (r.status === 'checked-out') continue;
    const rIn  = new Date(r.checkInDate);
    const rOut = new Date(r.checkOutDate);
    // Two ranges overlap when: start1 < end2 AND end1 > start2
    if (checkIn < rOut && checkOut > rIn) {
      occupiedByType[r.roomType] = (occupiedByType[r.roomType] ?? 0) + 1;
    }
  }

  const available = ROOM_INVENTORY
    .filter((rt) => {
      if (args.guests !== undefined && rt.maxGuests < args.guests) return false;
      if (args.roomType) {
        const want = args.roomType.toLowerCase();
        if (!rt.type.toLowerCase().includes(want)) return false;
      }
      const occupied = occupiedByType[rt.type] ?? 0;
      return occupied < rt.totalRooms;
    })
    .map((rt) => ({
      roomType:       rt.type,
      availableRooms: rt.totalRooms - (occupiedByType[rt.type] ?? 0),
      pricePerNight:  rt.pricePerNight,
      totalPrice:     rt.pricePerNight * nights,
      nights,
      maxGuests:      rt.maxGuests,
    }));

  if (available.length === 0) {
    return {
      available: [],
      message: 'No rooms match your criteria for those dates. Please try different dates or a different room type.',
    };
  }

  return {
    available,
    checkInDate:  args.checkInDate,
    checkOutDate: args.checkOutDate,
    nights,
  };
}

export async function createReservation(args: CreateReservationArgs): Promise<unknown> {
  // Validate the requested room type exists in inventory
  const roomDef = ROOM_INVENTORY.find(
    (rt) => rt.type.toLowerCase() === args.roomType.toLowerCase(),
  );
  if (!roomDef) {
    return {
      error:
        `Unknown room type "${args.roomType}". ` +
        `Available: ${ROOM_INVENTORY.map((r) => r.type).join(', ')}.`,
    };
  }

  if (args.guests > roomDef.maxGuests) {
    return {
      error:
        `${args.roomType} accommodates up to ${roomDef.maxGuests} guests, ` +
        `but ${args.guests} were requested. Please choose a larger room type.`,
    };
  }

  _walkInSeq += 1;
  const reservationId    = `WALK-${_walkInSeq}`;
  const confirmationCode = `WALK${_walkInSeq}`;

  const newRes: Reservation = {
    reservationId,
    confirmationCode,
    guestName:    args.guestName,
    roomNumber:   'TBD',   // physical room assigned at front desk during check-in
    roomType:     roomDef.type,
    checkInDate:  args.checkInDate,
    checkOutDate: args.checkOutDate,
    status:       'confirmed',
    guests:       args.guests,
    breakfastIncluded: false,
  };

  reservations.push(newRes);

  const nights = Math.round(
    (new Date(args.checkOutDate).getTime() - new Date(args.checkInDate).getTime()) / 86_400_000,
  );

  return {
    status:           'success',
    reservationId,
    confirmationCode,
    guestName:    args.guestName,
    contact:      args.contact,
    roomType:     roomDef.type,
    checkInDate:  args.checkInDate,
    checkOutDate: args.checkOutDate,
    guests:       args.guests,
    pricePerNight: roomDef.pricePerNight,
    totalPrice:   roomDef.pricePerNight * nights,
    nights,
    message:
      `Reservation confirmed! Confirmation code: ${confirmationCode}. ` +
      `Please present valid photo ID and this code at the front desk on arrival. ` +
      `Payment is settled at check-in from 15:00.`,
  };
}
