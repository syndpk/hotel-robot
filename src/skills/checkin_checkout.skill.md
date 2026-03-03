# SKILL: Check-in & Check-out Guardrails

## TRIGGERS
Use when the guest mentions: checking in, arrival, room ready, check-out, departure, leaving,
settling bill, late/early check-in/out, walk-in, no reservation, need a room tonight.

---

## REQUIRED_SLOTS

### Before `find_reservation`
- `guestName` — last name minimum (or full name)

### Before `check_in`
- `reservationId` — from a successful `find_reservation` call
- `idVerified: true` — identity verified via one of:
  - **UI ID Scan** (preferred): guest uses the 🪪 ID Scan button → you call `document.extract` to confirm
  - **Desk fallback**: guest confirms they can present a valid photo ID at the front desk
  *(Never ask for the ID number in chat or voice — always use the scan button or desk verification)*

### Before `check_out`
- `reservationId` — from a successful `find_reservation` call
- Explicit guest confirmation (see REQUIRED_CONFIRMATIONS)

### Before `check_availability`
- `checkInDate` (YYYY-MM-DD)
- `checkOutDate` (YYYY-MM-DD)
- `guests` count

### Before `create_reservation` — ALL of the following, in order:
1. `guestName` — **full name: first AND last name required** (single word = not acceptable)
2. `contact` — phone number or email address (**required, not optional**)
3. `checkInDate`, `checkOutDate`, `guests` — already confirmed
4. `roomType` — exact string from `check_availability` result
5. Booking summary shown + explicit "yes" from guest (see REQUIRED_CONFIRMATIONS)

---

## REQUIRED_CONFIRMATIONS

### check_out
Before calling `check_out`, ask:
> "Shall I go ahead and check you out now?"
Only proceed when the guest says yes / go ahead / confirm / sure.

### create_reservation
Before calling `create_reservation`, show this summary and ask for confirmation:
```
📋 Booking summary:
  Guest:    {guestName}
  Room:     {roomType}
  Dates:    {checkInDate} → {checkOutDate} ({N} night(s))
  Guests:   {guests}
  Contact:  {contact}

⚠️  A valid photo ID is required at check-in.
    Payment is settled at the front desk.

Shall I confirm this reservation? (Yes / No)
```
Only call `create_reservation` after the guest explicitly says yes.

---

## FORBIDDEN_CLAIMS
- Never invent reservation IDs, room numbers, confirmation codes, or prices.
- Never ask for credit card numbers, passport numbers, or government ID numbers.
- Never call `create_reservation` with a one-word guestName.
- Never call `create_reservation` without a contact value.
- Never promise specific room availability or pricing unless returned by `check_availability`.

---

## ESCALATION_TRIGGERS (use `handoff`)
- Reservation not found after **2** search attempts
- Billing or charge dispute
- Identity mismatch or guest cannot present a valid ID
- Guest requests payment processing via chat or voice
- Tool returns an error twice in a row

---

## INTENT BRANCHES

### A — Walk-in (guest has no reservation)
Signals: "walk-in", "no reservation", "no booking", "can I get a room"

1. Do **not** call `find_reservation`. Do **not** ask for a confirmation code.
2. Collect (one question at a time):
   - Full name (first + last)
   - Check-in and check-out dates (tonight = today → tomorrow)
   - Number of guests
3. Call `check_availability` with dates + guests (+ roomType preference if given).
4. Present available options clearly (room type, price per night, total).
5. Ask the guest to choose a room.
6. Collect `contact` (phone or email).
7. Show the full booking summary (see REQUIRED_CONFIRMATIONS above).
8. On "yes" → call `create_reservation`.
9. Reply with confirmation code + next steps (bring ID, pay at desk).

✅ Walk-in ends with a confirmed `reservationId`. No HANDOFF unless tool fails twice.

### B — Reservation check-in (guest has a booking)
1. Ask for name (last name minimum).
2. Call `find_reservation`.
3. If not found: ask **one** clarifier (confirmation code / spelling / booking channel).
4. Call `find_reservation` a second time.
5. Still not found → HANDOFF.
6. **Identity verification** (choose one path):
   - If the guest has used the 🪪 ID Scan button → call `document.extract` (pass sessionId from ## SESSION CONTEXT). If `available=true` and `confirmedByUser=true` → identity is verified, proceed with `idVerified=true`.
   - Otherwise → ask "Could you please use the 🪪 ID Scan button to scan your passport or ID, or confirm you'll present it at the desk?"
7. Call `check_in` with `idVerified=true`.

### C — Check-out
1. Ask for name (or room number if the guest volunteers it).
2. Call `find_reservation`.
3. If multiple matches → ask one clarifier.
4. Ask for explicit confirmation (see REQUIRED_CONFIRMATIONS).
5. On "yes" → call `check_out`.

---

## LOOP_PREVENTION
- Never call `find_reservation` twice with the **same** `{name, confirmationCode}` unless the guest provided new information.
- Never repeat a question the guest already answered.
- If the guest repeats their name and a search already failed once → ask a *different* clarifier or offer walk-in path.
