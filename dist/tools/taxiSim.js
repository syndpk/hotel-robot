"use strict";
/**
 * TaxiSim — deterministic taxi quote & booking simulator.
 *
 * Tools exposed:
 *   get_taxi_quote  — returns a priced quote valid for 30 min
 *   book_taxi       — converts a quote into a confirmed booking
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BookTaxiSchema = exports.GetQuoteSchema = void 0;
exports.getTaxiQuote = getTaxiQuote;
exports.bookTaxi = bookTaxi;
const zod_1 = require("zod");
// ── Route table ────────────────────────────────────────────────────────────────
/** Distances / base ETAs from the hotel to common Athens destinations. */
const ROUTES = {
    'airport': { km: 35, etaMin: 40 },
    'acropolis': { km: 4, etaMin: 15 },
    'piraeus': { km: 12, etaMin: 25 },
    'monastiraki': { km: 3, etaMin: 12 },
    'glyfada': { km: 18, etaMin: 30 },
    'kolonaki': { km: 2, etaMin: 10 },
    'stadium': { km: 2, etaMin: 10 },
    'parthenon': { km: 4, etaMin: 15 },
    'plaka': { km: 3, etaMin: 12 },
    'piraeus port': { km: 12, etaMin: 25 },
    'athens port': { km: 12, etaMin: 25 },
};
const BASE_FARE = 3.5; // EUR flag-fall
const RATE_PER_KM = 1.2; // EUR / km
const NIGHT_MULTIPLIER = 1.3; // 22:00 – 05:59
const AIRPORT_SURCHARGE = 3.8; // EUR (both directions)
const LARGE_GROUP_FACTOR = 1.15; // > 4 passengers
let quoteSeq = 1000;
const quoteStore = new Map();
// ── Tool schemas ───────────────────────────────────────────────────────────────
exports.GetQuoteSchema = zod_1.z.object({
    pickup: zod_1.z.string().describe('Pickup location, e.g. "hotel", "airport", "acropolis"'),
    dropoff: zod_1.z.string().describe('Drop-off destination, e.g. "airport", "monastiraki"'),
    pickupTime: zod_1.z.string().describe('Desired pickup time in HH:MM format, e.g. "14:30"'),
    passengers: zod_1.z
        .number()
        .int()
        .min(1)
        .max(8)
        .describe('Number of passengers (1–8)'),
});
exports.BookTaxiSchema = zod_1.z.object({
    quoteId: zod_1.z.string().describe('Quote ID returned by get_taxi_quote'),
    guestName: zod_1.z.string().describe('Full name of the guest requesting the taxi'),
    contactPhone: zod_1.z
        .string()
        .optional()
        .describe('Guest contact phone number (optional)'),
});
// ── Implementations ────────────────────────────────────────────────────────────
function normalizeLocation(loc) {
    return loc.toLowerCase().trim();
}
function lookupRoute(a, b) {
    const na = normalizeLocation(a);
    const nb = normalizeLocation(b);
    // Check direct keys and partial matches
    for (const [key, val] of Object.entries(ROUTES)) {
        if (na.includes(key) || nb.includes(key)) {
            return val;
        }
    }
    // Unknown route: reasonable Athens default
    return { km: 8, etaMin: 20 };
}
async function getTaxiQuote(args) {
    const { pickup, dropoff, pickupTime, passengers } = args;
    const route = lookupRoute(pickup, dropoff);
    const hour = parseInt(pickupTime.split(':')[0] ?? '12', 10);
    const isNight = hour >= 22 || hour < 6;
    const involvesAirport = normalizeLocation(pickup).includes('airport') ||
        normalizeLocation(dropoff).includes('airport');
    let price = BASE_FARE + route.km * RATE_PER_KM;
    if (isNight)
        price *= NIGHT_MULTIPLIER;
    if (involvesAirport)
        price += AIRPORT_SURCHARGE;
    if (passengers > 4)
        price *= LARGE_GROUP_FACTOR;
    price = Math.round(price * 100) / 100;
    const quoteId = `QT-${++quoteSeq}`;
    quoteStore.set(quoteId, {
        pickup,
        dropoff,
        price,
        etaMin: route.etaMin,
        expiresAt: Date.now() + 30 * 60_000,
    });
    return {
        quoteId,
        priceEstimate: price,
        currency: 'EUR',
        etaMinutes: route.etaMin,
        vehicleType: passengers > 4 ? 'minivan' : 'sedan',
        validForMinutes: 30,
        note: isNight ? 'Night-rate surcharge applied (22:00–06:00).' : undefined,
    };
}
let bookingSeq = 2000;
const bookingStore = new Map();
async function bookTaxi(args) {
    const { quoteId, guestName, contactPhone } = args;
    const quote = quoteStore.get(quoteId);
    if (!quote) {
        return {
            error: `Quote "${quoteId}" not found or has expired. Please request a new quote.`,
        };
    }
    if (Date.now() > quote.expiresAt) {
        quoteStore.delete(quoteId);
        return {
            error: `Quote "${quoteId}" has expired. Please request a new quote.`,
        };
    }
    const bookingId = `TXB-${++bookingSeq}`;
    const booking = {
        bookingId,
        quoteId,
        guestName,
        contactPhone: contactPhone ?? null,
        pickup: quote.pickup,
        dropoff: quote.dropoff,
        priceConfirmed: quote.price,
        currency: 'EUR',
        pickupEtaMinutes: quote.etaMin,
        pickupLocation: 'Hotel main entrance — Syntagma Square side. Look for the yellow taxi with the hotel sign.',
        status: 'confirmed',
        bookedAt: new Date().toISOString(),
    };
    bookingStore.set(bookingId, booking);
    return booking;
}
//# sourceMappingURL=taxiSim.js.map