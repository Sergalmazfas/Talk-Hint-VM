import type { BenchDirection } from "./copilotBench";

// Fictional numbers only: the guided stand must not repeat a caller's real details.
export const COPILOT_GUIDED_CASES: { id: string; direction: BenchDirection; phrase: string }[] = [
  { id: "yes-number", direction: "private", phrase: "Да, это мой номер." },
  { id: "yes-correct", direction: "private", phrase: "Да, всё правильно." },
  { id: "no-number", direction: "private", phrase: "Нет, это не мой номер." },
  { id: "not-earlier", direction: "private", phrase: "Нет, я буду через два часа, не раньше." },
  { id: "mint", direction: "private", phrase: "Я уже использую Mint Mobile." },
  { id: "move-number", direction: "private", phrase: "Я хочу перенести мой существующий номер на новый iPhone." },
  { id: "sim", direction: "private", phrase: "У меня есть действующая SIM-карта Mint Mobile." },
  { id: "carrier", direction: "private", phrase: "Сейчас я пользуюсь другим оператором." },
  { id: "repeat", direction: "private", phrase: "Повторите, пожалуйста, последний вопрос." },
  { id: "date", direction: "private", phrase: "Встреча назначена на двадцать четвёртое октября в одиннадцать тридцать утра." },
  { id: "digits", direction: "private", phrase: "Мой тестовый номер — пять пять пять, ноль один ноль, два ноль четыре восемь." },
  { id: "money", direction: "private", phrase: "На счёте тридцать семь долларов и пятьдесят центов." },
  { id: "guest-sim", direction: "guest", phrase: "Are you using a physical SIM card or an eSIM on your new iPhone?" },
  { id: "guest-confirm", direction: "guest", phrase: "Just to confirm, are you bringing your existing number to Mint Mobile?" },
  { id: "guest-digits", direction: "guest", phrase: "Is the test number five five five, zero one zero, two zero four eight correct?" },
];