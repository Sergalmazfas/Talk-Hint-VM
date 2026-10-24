---
name: Secretary live-call intent
description: Product constraint for the owner-initiated Secretary call and safe retry behavior.
---

The owner explicitly confirmed: “Только один звонок сразу; повтор запускаю сам.” A confirmed assignment and Call press authorize exactly one immediate outbound attempt. An uncertain network response is not permission to dial again. Recover or monitor the same attempt instead; a genuinely new call needs a fresh owner action and confirmation.

**Why:** The owner wants to enter the number personally, hear the Secretary conversation live, and decide if and when to repeat a call. Automatic retry can make an unexpected duplicate phone call.

**How to apply:** Keep the live monitoring feed read-only (no owner microphone) and separate from the legacy queued-task mechanism. For timeout and restart recovery, identify the original attempt durably rather than creating a new one.

The Secretary must conduct the entire conversation autonomously. The owner only sets the assignment and number, then listens and reads the two-party dialogue; they do not speak or send live hints to the Secretary. The Hint interface is a reference for assignment entry and design, not a feature to extend for Secretary work.

The Secretary should respond in the interlocutor's language: Russian to Russian,
English to English, Spanish to Spanish.

**Why:** The owner explicitly described this as the expected conversational
behavior; the assignment's language is not necessarily the call's language.

**How to apply:** Keep spoken-language selection distinct from transcription
and any owner-side translation setting. Do not infer that translated subtitles
show which language was actually spoken.

Live listening on the iPhone is mandatory in the existing owner's Swift/Xcode app, including assignments dictated or typed directly in that app, not only tasks created through ChatGPT. This requirement does not automatically expand the separate Expo client's scope.

**Why:** The owner explicitly corrected a misunderstanding that had led to unrelated live-Hint translation work. The Secretary is the speaker on the call, not the owner.

**How to apply:** Keep Secretary translation and call reporting confined to Secretary flows. Do not route owner audio or Hint suggestions into Secretary, and do not modify Hint merely because its task-entry design was reused.

Do not automatically read the entire prepared assignment aloud before dialing. Keep the complete text visible for review and confirmation; voice input may still be used to compose it.

**Why:** The owner found the automatic system-voice recitation of a long Russian assignment unpleasant and could not understand what was read. It happened before the call and was separate from the Secretary's live-call voice.

**How to apply:** Keep pre-call assignment confirmation visual unless a separately designed, intelligible playback option is explicitly requested.

The owner clarified “никаких записей” as “При звонке никаких сообщений что разговор записывается или транскрипция идет”. This clarification is not authorization to delete audio/text, disable transcription, or change retention.

**Why:** The user explicitly distinguished spoken notices from whether data is saved.

**How to apply:** Treat announcements, AI self-identification, audio recording, transcription and retention as separate decisions; do not infer changes to one from a request about another.