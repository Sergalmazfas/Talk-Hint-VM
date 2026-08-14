// Gold Call #1 — bank payment-plan dispute (SYNTHETIC, DE-IDENTIFIED).
// Modeled on the STRUCTURE of a real support call, but all identifying data
// is invented: caller name, bank and agent names, SSN, date of birth and the
// call identifier are synthetic. Only the generic dispute flow, dollar
// amounts and dates that drive the benchmark's number-accuracy metrics are
// retained. Nothing in this file is a verbatim production record.
// NO AUDIO EXISTS for this call (TalkHint never recorded audio) — so this
// fixture supports BRAIN and Replay benchmarks; EARS requires uploaded audio.

import type { ReferenceTurn, CriticalEntities } from "./types";

// Synthetic fixture key (NOT a real Twilio CallSid): the fixture is a
// de-identified reconstruction, not a verbatim production record.
export const GOLD_CALL_SOURCE_CALL_SID = "SYNTHETIC-GOLD-CALL-1";
export const GOLD_CALL_TITLE = "Gold Call #1 — bank payment-plan dispute (synthetic, de-identified)";
export const GOLD_CALL_KIND = "bank_dispute";

export const GOLD_CALL_GOAL =
  "The user already paid $200 and $150 and wants to understand why those are " +
  "treated as additional payments, whether the $350 already paid can be applied " +
  "to the missed scheduled payment of $317.80, and what must be done so the " +
  "payment plan does not break (deadline August 15).";

export const GOLD_CALL_CONFIRMED_FACTS: string[] = [
  "User already made two payments: $200 and $150 (total $350).",
  "The scheduled plan payment of $317.80 was reported missed; original payment was returned.",
  "Deadline to stay enrolled in the plan: August 15.",
  "Automatic plan payments are taken on the 10th of each month.",
  "Bank counts the $350 as additional payments, not as the missed scheduled payment.",
];

export const GOLD_CALL_CRITICAL_ENTITIES: CriticalEntities = {
  money: ["$317.80", "$200", "$150", "$350"],
  dates: ["August 15", "the tenth of each month", "September"],
  digits: ["7789", "212307789"],
  names: ["Alex", "Meridian Card Services", "Maria"],
  decisions: [
    "payments received but counted as additional",
    "original payment returned",
    "payment must be made by August 15 or the plan breaks",
    "agent offered to process the payment on the call",
  ],
};

// Verbatim transcript lines from the production record, in order.
const RAW: Array<[role: "owner" | "guest", text: string]> = [
  ["guest", "Thanks for calling Meridian Card Services. This call is being recorded."],
  ["guest", "Please say or enter the seven digit extension of your representative."],
  ["guest", "or say, I don't have it."],
  ["guest", "Please say or enter the seven digit extension of your representative."],
  ["guest", "or say, I don't have it."],
  ["guest", "Please say or enter the seven digit extension of your representative."],
  ["guest", "or say, I don't have it."],
  ["guest", "Let's get you to someone who can help."],
  ["guest", "Hi. Thank you so much for calling Meridian Card Services. My name is Maria. Agent ID MSR two six one on a recorded line. May I please have your full name?"],
  ["owner", "Hello. My name is Alex."],
  ["owner", "I have already made two payments of two hundred and one hundred fifty. Can I check my account, please?"],
  ["guest", "Okay. We can check that out. Could you tell me"],
  ["guest", "mister Alex. And what is your Social Security number"],
  ["guest", "or the account number?"],
  ["owner", "Last four."],
  ["guest", "The full social."],
  ["owner", "Seven seven eight nine."],
  ["guest", "Could you let me know the full Social Security number?"],
  ["owner", "Yeah. It's a good number."],
  ["guest", "Could you repeat that to me?"],
  ["owner", "seven seven eight nine."],
  ["owner", "Do you need my full Social Security number?"],
  ["guest", "Yes. That's what I'm asking you."],
  ["owner", "is two one two three zero seven seven eight nine"],
  ["guest", "Okay. Perfect, mister Alex. Could you tell me your date of birth?"],
  ["owner", "Uh, March twelve eighty five."],
  ["guest", "Thank you so much. Bear with me."],
  ["guest", "Okay, uh, mister Alex. I have your account over here. Before I go ahead and give you any more information, I have to let you know this is an attempt to collect a debt, and any information obtained will be used for that purpose. So I have over here that there was a payment that was that was supposed to be made for three hundred seventeen dollars and eighty cents."],
  ["guest", "Is that correct?"],
  ["owner", "Yes. It's correct. And I already paid twice, two hundred and one hundred fifty."],
  ["owner", "any check if those payments are recorded?"],
  ["guest", "Okay. Effectively, those payments were received. However, as the original payment was returned, there is an amount missing."],
  ["guest", "That's one it says over here. It says the latest plan payment has been missed, and the payment needs to be made by August fifteen to stay enrolled."],
  ["owner", "Fifteen fifteen. Okay. Okay. Okay."],
  ["owner", "Can you please confirm the total amount that's still included in missus payment?"],
  ["guest", "Yeah. Effectively, the payments that you made help the plan. But as they are additional,"],
  ["guest", "and still the main payment is due."],
  ["owner", "Yeah. It's not my mistake. Can you make this payment?"],
  ["owner", "Well, I don't know how it's working."],
  ["guest", "Okay. Um, I can certainly process the payment for you. After that, uh, the automatic payment would be taken out."],
  ["guest", "on the original date, which is the tenth of each month."],
  ["guest", "Is that okay with you?"],
  ["owner", "And... okay. And I will have I will have three payments. Yep. It's correct."],
  ["guest", "You would have three payments. Yes."],
  ["owner", "No. It's good. It's good."],
  ["guest", "Okay. So for this payment, mister Alex, would you like to use a checking account or a debit card?"],
  ["owner", "One second. I'd have to see. I opened the... on the... the app. Where is the app?"],
  ["owner", "I had to see."],
  ["owner", "I have to pay three hundred seventeen point eighteen."],
  ["owner", "Now I paid it three hundred fifty."],
  ["owner", "Can we can we make out... I don't know if how it's working, but I just wanna pay three hundred seventeen. It's eighty. And... yeah. I don't know."],
  ["owner", "And the next pay, I I think it will be it will be September."],
  ["guest", "Yes. That would be correct."],
  ["guest", "which is which is why we're we're asking about the payments because, as I mentioned before, the other amount that you paid was additional to the plan. The original amount is still due."],
  ["owner", "Mhmm. But I think it was my payment."],
  ["guest", "It's as... yes, sir. As I mentioned before, that would help with the plan, but you need to make the original amount because it say that the payment got returned."],
  ["guest", "Yes, mister. I'm still here."],
  ["owner", "Something."],
  ["owner", "I don't know."],
  ["owner", "I should... I I I I I"],
  ["guest", "I I I I need to remind you, sir, that we still need to make the payment for the plan to be active."],
  ["guest", "Yes. Uh, you make a payment you make a payment that help you with the balance, but the original amount is still due."],
  ["guest", "if we... you've done a pay that by tomorrow, the plan will break."],
  ["owner", "But it was my first payment."],
];

export const GOLD_CALL_TURNS: ReferenceTurn[] = RAW.map(([role, text], idx) => ({ idx, role, text }));
