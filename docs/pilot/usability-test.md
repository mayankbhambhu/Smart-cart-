# Usability test: 20 shoppers in the pilot store

A one-day, in-store test of the shopper app and the store team's screens before the DMart pilot
opens to everyone. It answers one question: **can an ordinary DMart shopper pair a cart, shop,
pay and leave without help, and does the store team keep up?**

This kit has everything a two-person team needs: who to recruit, the tasks, what to measure, the
observer sheet, the consent wording and how to report. Print the observer sheet (one per shopper)
and the consent card.

## At a glance

| | |
|---|---|
| Shoppers | 20, recruited at the entrance or by the store, each paid with a ₹200 store voucher |
| Time per shopper | 25 to 30 minutes, including consent and the closing questions |
| Day | One weekday: 10 shoppers 10:00 to 13:00, 10 shoppers 17:00 to 20:00 (quiet and busy hours) |
| Team | A moderator (walks with the shopper, reads tasks) and a note-taker (times, errors, quotes) |
| Store team | One floor staff member with the handheld in staff mode, one manager on the dashboard |
| Devices | Shoppers use **their own phones** where possible; keep the project's Android phone and iPhone as spares |
| Build | The pilot build on staging with the test payment (no real money), the seeded catalogue and offers |

## Who to recruit

Aim for a mix that looks like the store's weekday shoppers. Screen at the entrance with three
questions (age band, the language they're most comfortable in, the phone they carry) and fill the
quotas below; stop recruiting a group once it's full.

| Group | Quota |
|---|---|
| Aged 18 to 34 / 35 to 54 / 55 and over | 7 / 8 / 5 |
| Prefer Hindi / Marathi / English | 8 / 4 / 8 |
| Android / iPhone | 15 / 5 |
| Has used a self-checkout or scan-and-go app before | no more than 8 |
| Shops with a child or a second person | at least 3 |

Leave out store employees and their families, and anyone under 18.

## Before the day

- [ ] Staging is up, seeded, and `python -m smartcart.seed_history` has **not** been run on it (keep the test's numbers clean).
- [ ] Barcode labels printed for the 20 test products below and stuck on the packs (the seed's codes are synthetic).
- [ ] Carts C-0001 to C-0012 charged (check the Cart fleet page: all above 80%, no faults) and their pairing QR codes on the handles.
- [ ] Two cart scales calibrated with a 1 kg weight; note the reading.
- [ ] The app installed from the internal test track on the spare phones, signed out.
- [ ] Three offers running on the Offers page, one in aisle A1 so every shopper meets an aisle deal.
- [ ] Consent cards, observer sheets, a stopwatch app, vouchers, pens.
- [ ] The store manager has briefed the floor staff member on the Security page wording: alerts mean **check**, never accuse.

## The tasks

Read each task aloud exactly as written. Don't show where to tap. If a shopper is stuck for 60
seconds or asks for help twice, help them, mark the task **assisted**, and move on.

| # | Task (read aloud) | Success means | Time limit |
|---|---|---|---|
| 1 | "Please download the app and sign in the way you'd normally sign in to apps." | Signed in as a shopper (Google, Apple or phone) | 4 min |
| 2 | "Take this cart and connect your phone to it." | Cart paired, live cart screen showing | 2 min |
| 3 | "You need haldi. Find out where it is, by speaking to the app." (Hindi speakers in Hindi) | Voice search used; shopper walks to the right aisle | 2 min |
| 4 | "Put these five things in your cart the way the app expects." (milk, atta, biscuits, toor dal, shampoo) | All five scanned, quantities right, total matches the five | 6 min |
| 5 | "The app may tell you about offers. Is there one in this aisle?" | Shopper notices the aisle deal and can say the price | 1 min |
| 6 | Moderator quietly puts a pack of tea in the basket without scanning it. "Carry on shopping." | Shopper sees the "hasn't been scanned" message and scans or removes the tea, without staff | 2 min |
| 7 | "You've changed your mind about the biscuits." | Biscuits removed, total updated | 1 min |
| 8 | "You can't find jeera. Get someone from the store to help." | Help requested; floor staff arrive | 4 min |
| 9 | "You're done. Pay and leave the store." | Paid with the test payment, exit code shown, exit check passed at the door | 4 min |

The store team is tested at the same time: the note-taker records how long help takes to arrive
(task 8), whether the tea alert in task 6 reached the Security page (it should only if the shopper
ignored the nudge for 45 seconds), and how the exit check went.

## What to measure

For each shopper and task:

- **Completion**: done unaided, done assisted, or not done.
- **Time on task**, from the end of the instruction to success.
- **Errors**: wrong taps that cost time, a wrong item or quantity in the cart, any message the
  shopper misread.
- **Ease** (Single Ease Question) after each task: "How easy was that? 1 very hard to 7 very
  easy." Ask in the shopper's language.
- **Quotes**: anything said aloud, verbatim, especially confusion or trust ("will it charge me
  twice?").

After the tasks:

- **SUS** (System Usability Scale): the standard 10 statements, read aloud in the shopper's
  language, answered 1 to 5. Use the Hindi and Marathi wording the team agreed in advance; don't
  translate on the spot.
- Three open questions: "What was the most confusing moment?", "Would you use this on your next
  visit? Why?", "What would you tell a friend about it?"

## Pass marks for the pilot

These decide whether the pilot opens on schedule or the app gets another round first.

| Measure | Pass |
|---|---|
| Pair a cart (task 2) unaided | 18 of 20 |
| Scan five items correctly (task 4) | 17 of 20, median under 4 minutes |
| Unscanned item handled after the nudge, without staff (task 6) | 15 of 20 |
| Pay and leave (task 9) unaided | 18 of 20 |
| Help arrives (task 8) | median under 3 minutes |
| SUS score | average 70 or more |
| Shoppers stopped at the exit by mistake | none |

Any shopper charged wrongly, any exit check that let an unpaid cart through, or any alert worded
as an accusation is a **stop**: fix it before the pilot whatever the other numbers say.

## Observer sheet (one per shopper)

```
Shopper no. ___   Time slot ___   Age band ___   Language ___   Phone: Android / iPhone
Used scan-and-go before? Y / N   Shopping with someone? Y / N   Consent card signed? Y / N

Task | Unaided / Assisted / Not done | Time (m:ss) | Errors | Ease 1-7 | Notes and quotes
 1   |                              |             |        |          |
 2   |                              |             |        |          |
 3   |                              |             |        |          |
 4   |                              |             |        |          |
 5   |                              |             |        |          |
 6   |                              |             |        |          |  Alert reached Security? Y / N
 7   |                              |             |        |          |
 8   |                              |             |        |          |  Staff arrived after ___ min
 9   |                              |             |        |          |  Exit check: pass / bag check / problem

SUS answers (1-5):  1 __  2 __  3 __  4 __  5 __  6 __  7 __  8 __  9 __  10 __
Most confusing moment:
Use it next visit? Why:
Tell a friend:
```

## Consent card (read aloud, then sign)

> We're testing a new way to shop at this store, and we're testing the app, not you. There are
> no wrong answers. It takes about 30 minutes and you'll get a ₹200 voucher. We'll write notes
> and time how long things take. We won't record your face or voice, and we won't keep your
> name with your answers. You won't be charged for anything: the payment is a test. You can stop
> at any time and still keep the voucher. Is that all right?

Signature or thumbprint ____  Date ____

Keep signed cards separately from the observer sheets, which carry only the shopper number. This
follows India's Digital Personal Data Protection Act, 2023: collect only what the test needs,
say why, and delete the sheets' personal details once the report is written.

## After the day

1. Put every observer sheet into one spreadsheet (one row per shopper and task) the same evening.
2. Work out completion rates, median times, mean ease per task, and the SUS score (for each
   shopper: odd items minus 1, 5 minus even items, sum, times 2.5; then average).
3. List every problem seen with how many shoppers hit it and how badly: **blocker** (couldn't
   continue), **major** (needed help or lost over a minute), **minor** (slowed down).
4. Compare with the dashboard's **Analytics** page for the test day (orders, pairing-to-paid
   time, cart alerts and how they ended, help by aisle) as a check on the notes.
5. Report in two pages: the pass-mark table, the top five problems with a fix for each, and three
   quotes. Decide go or another round with the store manager.
