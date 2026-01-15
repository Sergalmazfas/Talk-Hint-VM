/**
 * Slot Extractors
 * 
 * Rule-based regex/heuristics для извлечения слотов из текста.
 * Поддерживает английский и русский языки.
 */

import { SlotMap, SLOT_KEYS } from "../shared/goalTypes";

export interface ExtractionResult {
  slot: keyof SlotMap;
  value: string;
  confidence: number;
}

const DATE_PATTERNS = [
  /\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\b(next\s+(?:week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i,
  /\b(\d{1,2}(?:st|nd|rd|th)?(?:\s+of)?\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?))\b/i,
  /\b(\d{1,2}[\/\-\.]\d{1,2}(?:[\/\-\.]\d{2,4})?)\b/,
  /\b(сегодня|завтра|послезавтра|понедельник|вторник|среда|четверг|пятница|суббота|воскресенье)\b/i,
  /\b(на\s+(?:этой|следующей)\s+неделе)\b/i,
  /\b(\d{1,2}(?:-?(?:го|ого)?)?(?:\s+)?(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря))\b/i
];

const TIME_PATTERNS = [
  /\b(\d{1,2}:\d{2}(?:\s*(?:am|pm|AM|PM))?)\b/,
  /\b(\d{1,2}\s*(?:am|pm|AM|PM))\b/,
  /\b((?:at\s+)?\d{1,2}(?:\s*o'?clock)?)\b/i,
  /\b(noon|midnight|morning|afternoon|evening)\b/i,
  /\b(в\s+\d{1,2}(?::\d{2})?(?:\s+(?:часов|часа|час))?)\b/i,
  /\b(\d{1,2}(?::\d{2})?\s*(?:утра|вечера|дня|ночи))\b/i,
  /\b(полдень|полночь|утром|днём|вечером)\b/i
];

const PHONE_PATTERNS = [
  /\+?1?[-.\s]?\(?(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})/,
  /\b(\d{3}[-.\s]?\d{3}[-.\s]?\d{4})\b/,
  /\+7[-.\s]?\(?(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{2})[-.\s]?(\d{2})/,
  /8[-.\s]?\(?(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{2})[-.\s]?(\d{2})/,
  /(?:my\s+(?:number|phone)\s+is|call\s+me\s+at|reach\s+me\s+at)\s*:?\s*([+\d\s\-().]+)/i,
  /(?:мой\s+(?:номер|телефон))\s*:?\s*([+\d\s\-().]+)/i
];

const NAME_PATTERNS = [
  /(?:my\s+name\s+is|i'm|i\s+am|this\s+is|call\s+me)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
  /(?:меня\s+зовут|это|я)\s+([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?)/i,
  /(?:for|под\s+(?:имя|именем))\s+([A-ZА-ЯЁ][a-zа-яё]+)/i
];

const LOCATION_PATTERNS = [
  /(?:at|on|located\s+at)\s+(\d+\s+[A-Za-z\s]+(?:street|st|avenue|ave|road|rd|drive|dr|blvd|way|lane|ln))/i,
  /(?:address\s+is|come\s+to)\s+([^,.\n]+)/i,
  /(?:адрес|по\s+адресу|на)\s+([^,.\n]+(?:улица|ул\.|проспект|пр\.|дом|д\.)[^,.\n]*)/i,
  /(?:офис|кабинет|комната)\s+(\d+[A-Za-zА-Яа-я]?)/i
];

const PRICE_PATTERNS = [
  /\$\s?(\d+(?:[.,]\d{2})?)/,
  /(\d+(?:[.,]\d{2})?)\s*(?:dollars?|bucks?|USD)/i,
  /(?:cost(?:s)?|price\s+is|total\s+is|that'?s?|will\s+be|comes?\s+to)\s*\$?\s*(\d+(?:[.,]\d{2})?)/i,
  /(\d+(?:[.,]\d{2})?)\s*(?:рублей|рубля|руб\.?|₽)/i,
  /(?:стоит|цена|стоимость)\s*:?\s*(\d+(?:[.,]\d{2})?)/i
];

const SERVICE_PATTERNS = [
  /(?:need|want|looking\s+for|book(?:ing)?|schedule)\s+(?:a\s+)?([a-z]+(?:\s+[a-z]+)?(?:\s+(?:appointment|session|visit|service))?)/i,
  /(?:for\s+(?:a|an|the))\s+([a-z]+(?:\s+[a-z]+)?)/i,
  /(?:хочу|нужен|нужна|записаться\s+на)\s+([а-яё]+(?:\s+[а-яё]+)?)/i,
  /(?:массаж|приём|консультация|уборка|стрижка|маникюр|педикюр)/i
];

function extractWithPatterns(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1] || match[0];
    }
  }
  return null;
}

export function extractDate(text: string): string | null {
  return extractWithPatterns(text, DATE_PATTERNS);
}

export function extractTime(text: string): string | null {
  return extractWithPatterns(text, TIME_PATTERNS);
}

export function extractPhone(text: string): string | null {
  const result = extractWithPatterns(text, PHONE_PATTERNS);
  if (result) {
    return result.replace(/[^\d+]/g, '');
  }
  return null;
}

export function extractName(text: string): string | null {
  return extractWithPatterns(text, NAME_PATTERNS);
}

export function extractLocation(text: string): string | null {
  return extractWithPatterns(text, LOCATION_PATTERNS);
}

export function extractPrice(text: string): string | null {
  const result = extractWithPatterns(text, PRICE_PATTERNS);
  if (result) {
    const numericMatch = result.match(/\d+(?:[.,]\d{2})?/);
    return numericMatch ? numericMatch[0] : result;
  }
  return null;
}

export function extractService(text: string): string | null {
  return extractWithPatterns(text, SERVICE_PATTERNS);
}

export function extractAllSlots(text: string): Partial<SlotMap> {
  const result: Partial<SlotMap> = {};
  
  const date = extractDate(text);
  if (date) result.date = date;
  
  const time = extractTime(text);
  if (time) result.time = time;
  
  const phone = extractPhone(text);
  if (phone) result.phone = phone;
  
  const name = extractName(text);
  if (name) result.name = name;
  
  const location = extractLocation(text);
  if (location) result.location = location;
  
  const price = extractPrice(text);
  if (price) result.price = price;
  
  const service = extractService(text);
  if (service) result.service = service;
  
  return result;
}

export function mergeSlots(existing: SlotMap, extracted: Partial<SlotMap>): SlotMap {
  const merged = { ...existing };
  for (const key of SLOT_KEYS) {
    if (extracted[key]) {
      merged[key] = extracted[key]!;
    }
  }
  return merged;
}
