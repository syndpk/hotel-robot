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
import { z } from 'zod';
export declare const FindReservationSchema: z.ZodObject<{
    name: z.ZodString;
    confirmationCode: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    name: string;
    confirmationCode?: string | undefined;
}, {
    name: string;
    confirmationCode?: string | undefined;
}>;
export type FindReservationArgs = z.infer<typeof FindReservationSchema>;
export declare const CheckInSchema: z.ZodObject<{
    reservationId: z.ZodString;
    idVerified: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    reservationId: string;
    idVerified: boolean;
}, {
    reservationId: string;
    idVerified: boolean;
}>;
export type CheckInArgs = z.infer<typeof CheckInSchema>;
export declare const CheckOutSchema: z.ZodObject<{
    reservationId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    reservationId: string;
}, {
    reservationId: string;
}>;
export type CheckOutArgs = z.infer<typeof CheckOutSchema>;
export declare const CheckAvailabilitySchema: z.ZodObject<{
    checkInDate: z.ZodString;
    checkOutDate: z.ZodString;
    roomType: z.ZodOptional<z.ZodString>;
    guests: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    checkInDate: string;
    checkOutDate: string;
    roomType?: string | undefined;
    guests?: number | undefined;
}, {
    checkInDate: string;
    checkOutDate: string;
    roomType?: string | undefined;
    guests?: number | undefined;
}>;
export type CheckAvailabilityArgs = z.infer<typeof CheckAvailabilitySchema>;
export declare const CreateReservationSchema: z.ZodObject<{
    guestName: z.ZodString;
    checkInDate: z.ZodString;
    checkOutDate: z.ZodString;
    roomType: z.ZodString;
    guests: z.ZodNumber;
    contact: z.ZodString;
}, "strip", z.ZodTypeAny, {
    guestName: string;
    roomType: string;
    checkInDate: string;
    checkOutDate: string;
    guests: number;
    contact: string;
}, {
    guestName: string;
    roomType: string;
    checkInDate: string;
    checkOutDate: string;
    guests: number;
    contact: string;
}>;
export type CreateReservationArgs = z.infer<typeof CreateReservationSchema>;
export declare function findReservation(args: FindReservationArgs): Promise<unknown>;
export declare function checkIn(args: CheckInArgs): Promise<unknown>;
export declare function checkOut(args: CheckOutArgs): Promise<unknown>;
export declare function checkAvailability(args: CheckAvailabilityArgs): Promise<unknown>;
export declare function createReservation(args: CreateReservationArgs): Promise<unknown>;
