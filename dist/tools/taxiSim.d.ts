/**
 * TaxiSim — deterministic taxi quote & booking simulator.
 *
 * Tools exposed:
 *   get_taxi_quote  — returns a priced quote valid for 30 min
 *   book_taxi       — converts a quote into a confirmed booking
 */
import { z } from 'zod';
export declare const GetQuoteSchema: z.ZodObject<{
    pickup: z.ZodString;
    dropoff: z.ZodString;
    pickupTime: z.ZodString;
    passengers: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    dropoff: string;
    pickup: string;
    pickupTime: string;
    passengers: number;
}, {
    dropoff: string;
    pickup: string;
    pickupTime: string;
    passengers: number;
}>;
export type GetQuoteArgs = z.infer<typeof GetQuoteSchema>;
export declare const BookTaxiSchema: z.ZodObject<{
    quoteId: z.ZodString;
    guestName: z.ZodString;
    contactPhone: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    quoteId: string;
    guestName: string;
    contactPhone?: string | undefined;
}, {
    quoteId: string;
    guestName: string;
    contactPhone?: string | undefined;
}>;
export type BookTaxiArgs = z.infer<typeof BookTaxiSchema>;
export declare function getTaxiQuote(args: GetQuoteArgs): Promise<unknown>;
export declare function bookTaxi(args: BookTaxiArgs): Promise<unknown>;
