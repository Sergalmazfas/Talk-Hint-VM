import { ChevronDown, Loader2, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export type PersonalityCatalogItem = {
  id: string;
  slug: string;
  name: string;
  description: string;
  status: "available" | "retired";
  currentVersion: number;
};
export type PersonalityVersion = {
  version: number;
  name: string;
  description: string;
  rules: string;
  examples: string[];
  modeGuidance: { personal: string; work: string };
};

export function SecretaryPersonalityCatalog({
  items,
  busy,
  query,
  cursor,
  admin,
  details,
  onQueryChange,
  onLoadMore,
  onOpen,
  onChoose,
  onEdit,
  onCloseDetails,
}: {
  items: PersonalityCatalogItem[];
  busy: boolean;
  query: string;
  cursor: string | null;
  admin: boolean;
  details: PersonalityVersion | null;
  onQueryChange: (query: string) => void;
  onLoadMore: () => void;
  onOpen: (item: PersonalityCatalogItem) => void;
  onChoose: (item: PersonalityCatalogItem) => void;
  onEdit: (item: PersonalityCatalogItem) => void;
  onCloseDetails: () => void;
}) {
  const subpanel = "rounded-xl border border-[#344b4f] bg-[#122328]";
  return (
    <Card className="border-[#344b4f] bg-[#17282d] text-[#e8efec]">
      <CardHeader className="gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.15em] text-teal-300">Общий каталог</p>
          <CardTitle className="text-xl">Характеры и правила</CardTitle>
          <CardDescription className="mt-1 text-[#a9bbb7]">Префиксный поиск: совпадение в начале имени или slug. Каталог загружается страницами.</CardDescription>
        </div>
        <div className="relative w-full sm:max-w-xs"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7e9690]" /><Input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Поиск по каталогу" className="border-[#40585c] bg-[#102025] pl-9 text-white placeholder:text-[#70827e]" /></div>
      </CardHeader>
      <CardContent className="space-y-3">
        {busy && !items.length ? <div className="space-y-3"><div className="h-20 animate-pulse rounded-xl bg-[#20363a]" /><div className="h-20 animate-pulse rounded-xl bg-[#20363a]" /></div> : items.length ? (
          <div className="space-y-2">
            {items.map((personality) => <article key={personality.id} className={`${subpanel} p-4`}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <button type="button" onClick={() => onOpen(personality)} className="min-w-0 flex-1 text-left">
                  <span className="flex flex-wrap items-center gap-2"><strong className="text-base text-[#e1ebe6]">{personality.name}</strong><Badge className={personality.status === "available" ? "border-[#3e7065] bg-[#1e3935] text-teal-200" : "border-[#69583a] bg-[#342e22] text-amber-100"}>{personality.status === "available" ? "Доступен" : "В архиве"}</Badge><span className="font-mono text-xs text-[#829993]">v{personality.currentVersion}</span></span>
                  <span className="mt-2 block text-sm leading-5 text-[#adbfbb]">{personality.description || "Описание не добавлено."}</span>
                  <span className="mt-2 block font-mono text-[11px] text-[#7e9690]">{personality.slug}</span>
                </button>
                <div className="flex shrink-0 gap-2">
                  {personality.status === "available" && <Button size="sm" variant="outline" onClick={() => onChoose(personality)} className="border-[#4a6665] text-[#c7dfd8] hover:bg-[#25413f]">Выбрать</Button>}
                  {admin && <Button size="sm" variant="ghost" onClick={() => onEdit(personality)} className="text-teal-200 hover:bg-[#203a39]">Редактировать</Button>}
                </div>
              </div>
            </article>)}
            {cursor && <Button variant="outline" onClick={onLoadMore} disabled={busy} className="w-full border-[#4a6665] text-[#c7dfd8] hover:bg-[#25413f]">{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ChevronDown className="mr-2 h-4 w-4" />}Загрузить ещё</Button>}
          </div>
        ) : <div className={`${subpanel} p-6 text-center`}>
          <p className="text-sm font-medium text-[#dce8e4]">Ничего не найдено</p>
          <p className="mt-1 text-xs leading-5 text-[#8fa49f]">{query ? "Попробуйте другой запрос." : "Доступных характеров пока нет."}</p>
        </div>}
        {details && <div className="rounded-xl border border-[#45615d] bg-[#142b2c] p-4">
          <div className="flex items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-wide text-teal-300">Текущая редакция · v{details.version}</p><h3 className="mt-1 text-lg font-semibold">{details.name}</h3></div><Button size="sm" variant="ghost" onClick={onCloseDetails} className="text-[#a9bbb7]">Закрыть</Button></div>
          <p className="mt-2 text-sm leading-5 text-[#bdcbc7]">{details.description}</p>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[#d9e4df]">{details.rules}</p>
          {!!details.examples.length && <div className="mt-3 space-y-2"><p className="text-xs font-semibold uppercase tracking-wide text-[#8fa49f]">Примеры</p>{details.examples.map((example, index) => <p key={index} className="border-l-2 border-teal-700 pl-3 text-sm italic text-[#bdcbc7]">“{example}”</p>)}</div>}
          <div className="mt-4 grid gap-3 sm:grid-cols-2"><div className="rounded-lg bg-[#102025] p-3"><p className="text-xs font-semibold text-teal-200">Personal</p><p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-[#afc0bc]">{details.modeGuidance.personal}</p></div><div className="rounded-lg bg-[#102025] p-3"><p className="text-xs font-semibold text-teal-200">Work</p><p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-[#afc0bc]">{details.modeGuidance.work}</p></div></div>
        </div>}
      </CardContent>
    </Card>
  );
}
