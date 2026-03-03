/**
 * Hotel configuration — injected into every agent prompt.
 * Edit this file (or replace with a DB-backed config) to adapt to another property.
 */

import { HotelConfig } from '../core/types';

export const HOTEL_CONFIG: HotelConfig = {
  name: 'Hotel Athena Grand',
  city: 'Athens, Greece',
  address: '123 Syntagma Square, Athens 105 57, Greece',
  phone: '+30 21 0000 0000',
  checkInTime: '15:00',
  checkOutTime: '12:00',
  policies: {
    pets: 'No pets allowed on the premises.',
    smoking: 'Strictly non-smoking property; €250 fine for violations.',
    cancellation: 'Free cancellation up to 24 hours before check-in; full charge thereafter.',
    breakfast: {
      included: 'Included in most room rates — confirm at check-in.',
      hours: '07:00–10:30',
      location: 'Restaurant Agora, Ground Floor',
    },
    wifi: {
      network: 'AthenaGrand_Guest',
      password: 'Welcome2024',
      note: 'Share with guest only after check-in.',
    },
    parking: 'Valet parking available at €25 per day; notify concierge on arrival.',
    lateCheckOut:
      'Late check-out until 14:00 available for €30 surcharge, subject to availability.',
    earlyCheckIn:
      'Early check-in from 12:00 available for €20 surcharge, subject to availability.',
    luggage: 'Complimentary luggage storage before check-in and after check-out.',
    pool: 'Rooftop pool open 09:00–21:00 (May–October). Pool towels provided.',
    spa: 'Spa & Wellness Centre open 08:00–22:00. Advance booking recommended.',
    currency: 'EUR',
    languagesSpoken: ['English', 'Greek', 'French', 'German'],
  },
};
