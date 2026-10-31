/** Selection is limited to labels actually heard in the current menu. */
export function listedOptions(menu: string): { digits: string; label: string }[] {
  const values: Record<string, string> = { zero: "0", one: "1", two: "2", three: "3",
    four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9",
    star: "*", pound: "#", hash: "#" };
  const token = "([0-9*#]{1,5}|zero|one|two|three|four|five|six|seven|eight|nine|star|pound|hash)";
  const options: { digits: string; label: string }[] = [];
  const commands = Array.from(menu.matchAll(new RegExp(`\\b(?:press|dial|enter)\\s+${token}(?![a-z0-9])`, "gi")));
  for (let index = 0; index < commands.length; index++) {
    const match = commands[index];
    const previous = commands[index - 1];
    const before = menu.slice(previous ? previous.index! + previous[0].length : 0, match.index);
    const after = menu.slice(match.index! + match[0].length, commands[index + 1]?.index ?? menu.length);
    // Bind each number to its OWN label, including comma-separated ASR.
    // Never let "general manager" later in a long sentence relabel the fuel digit.
    const label = /^\s+(?:for|if|to)\b/i.test(after)
      ? after.split(/[.!?;]/)[0].trim()
      : (before.split(/[.!?;]/).at(-1) ?? "").replace(/^[,\s]+|[,\s]+$/g, "");
    options.push({ digits: values[match[1].toLowerCase()] ?? match[1], label });
  }
  return options;
}

export function chooseMenuOption(menu: string, goal: string) {
  const options = listedOptions(menu);
  const pick = (pattern: RegExp, reason: string) => {
    const option = options.find(o => pattern.test(o.label));
    return option && { digits: option.digits, reason };
  };
  const parking = /park|reserv|book|парков|стоян|бронир/i.test(goal);
  const repair = /tire|repair|service|шины|шин|ремонт|сервис/i.test(goal);
  const roadside = /roadside|emergency|обочин|дорог/i.test(goal);
  return (parking ? pick(/park|reserv|book/i, "exact_parking_or_reservation_option") : undefined)
    ?? (roadside ? pick(/roadside|emergency/i, "goal_roadside_assistance") : undefined)
    ?? (repair && !parking ? pick(/(?:parts|shop|truck|tire).*(?:service|repair)|service advisor|tire|repair/i, "goal_truck_service") : undefined)
    ?? pick(/general manager/i, "no_exact_option_general_manager")
    ?? pick(/\bmanager\b/i, "no_exact_option_manager")
    ?? pick(/operator|representative|human|person/i, "no_exact_option_human")
    ?? pick(/repeat|replay/i, "repeat_current_menu");
}

export type IvrTranscriptTurn = { id: string; role: string; text: string; afterTurn?: number; at?: string };
/** Place dispatches after the menu heard at dispatch, not at the end of every later snapshot. */
export function mergeIvrTranscript<T extends IvrTranscriptTurn>(spoken: T[], actions: T[]): T[] {
  const result: T[] = [];
  const placed = new Set<string>();
  for (const turn of spoken) {
    result.push(turn);
    const index = /^retell:(\d+)$/.exec(turn.id);
    if (!index) continue;
    for (const action of actions) if (action.afterTurn === Number(index[1]) && !placed.has(action.id)) {
      result.push(action); placed.add(action.id);
    }
  }
  // Legacy actions have no timing anchor; do not invent their chronology.
  return [...result, ...actions.filter(a => !placed.has(a.id))];
}
