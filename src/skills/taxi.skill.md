# SKILL: Reception — Taxi & Transfers (Guardrails + Tool Policy)

## Purpose
Book taxis reliably and safely while preserving natural conversation. This skill defines **tool prerequisites, confirmations, branching rules, and loop prevention** (not a rigid script).

## When to use
Use when the guest mentions: taxi, cab, transfer, ride, airport, pickup, drop-off, transport, shuttle, van, minivan.

---

## Global rules (always apply)
- Never invent prices, ETAs, vehicle types, or booking IDs.
- Do not ask for payment/card details.
- Ask **one question at a time** unless the guest is in a hurry.
- If required info is missing, **ASK_USER** rather than guessing.
- Prevent duplicates: if the guest repeats “book it” with unchanged details, do not re-book—confirm existing booking.

---

## Tools allowed
- `taxi.get_quote({ pickup, dropoff, pickupTime, passengers })`
- `taxi.book({ quoteId, guestName, contactPhone? })`

### Tool prerequisites
**Before `taxi.get_quote`:**
- Must have:
  - `pickup` (default: hotel main entrance)
  - `dropoff` (destination)
  - `pickupTime` (either “ASAP” or a specific time; if specific time, confirm date if ambiguous)
  - `passengers` (default: 1)

**Before `taxi.book`:**
- Must have `quoteId` from `taxi.get_quote`
- Must have `guestName`
- Must have explicit confirmation from guest (YES) with key details repeated

---

## Slot defaults (to reduce friction)
- `pickup`: default to “Hotel main entrance / reception” unless guest specifies another pickup point.
- `passengers`: default to 1.
- `pickupTime`: if guest says “now / ASAP”, treat as ASAP (no need for HH:MM).  
  If your tool requires HH:MM, convert “ASAP” to “now + ~10 min” and state it clearly.
- `dropoff`: must be provided by guest (do not guess).

---

## Branch rules (avoid common failure modes)

### A) Guest asks for taxi “now / ASAP”
1. Confirm destination (dropoff).
2. Confirm passengers (if not given).
3. Call `taxi.get_quote` with pickupTime="ASAP" (or nearest time your tool requires).
4. Present quote + ETA.
5. Ask for confirmation, then book.

### B) Guest asks for taxi at a specific time
1. Confirm destination + time.
2. If time is given but date is unclear (e.g., “7am”): ask “today or tomorrow?”
3. Call `taxi.get_quote`.
4. Present quote + scheduled pickup details.
5. Ask for confirmation, then book.

### C) Guest asks for airport transfer
- Ask which airport/terminal (one clarifier).
- Proceed as normal quote → confirm → book.

### D) Changes after quote
If guest changes any of: pickup/dropoff/time/passengers:
- discard old quote, call `taxi.get_quote` again with updated details.

---

## Confirmation gate (mandatory)
Before calling `taxi.book`, restate the booking details:

Example template (keep natural):
- “Just to confirm: pickup from **[pickup]**, going to **[dropoff]**, at **[time]**, for **[passengers]** passenger(s). The estimate is **[price/eta]**. Shall I book it?”

Only proceed on an explicit “yes / please book / confirm”.

---

## Loop & idempotency rules (mandatory)
- Do not call `taxi.get_quote` twice with the same arguments unless:
  - the previous attempt failed, OR
  - the guest changed details.
- Do not call `taxi.book` twice for the same quoteId.
- If a booking was already created in this session:
  - show booking ID and details
  - ask if they want to modify/cancel (if supported) or keep it

---

## Error handling
- If `taxi.get_quote` fails:
  - apologize, retry once
  - if still failing, offer human handoff and summarize collected details
- If `taxi.book` fails:
  - do not claim success
  - offer retry or handoff, summarize details + quoteId if available
- If destination is ambiguous:
  - ask one clarifier (e.g., “Which entrance/terminal/address?”)

---

## Safety & escalation
Escalate to staff if:
- repeated tool failures
- guest requests payment handling
- guest requests transport for a safety-sensitive situation (e.g., unaccompanied minor) or special medical transport

---

## Done when
- Taxi booking is confirmed with booking ID and pickup instructions, OR
- Guest declines after quote, OR
- Escalated to staff with a concise summary (pickup, dropoff, time, passengers).