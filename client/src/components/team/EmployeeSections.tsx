import type { ReactNode } from "react";
import type { EmployeeSections } from "@shared/employeeSections";

function displayValue(value: string | null | undefined) {
  return value?.trim() ? value : "Не заполнено";
}

function TextList({ values }: { values: string[] }) {
  return values.length ? (
    <ul className="mt-2 space-y-1.5">
      {values.map((value, index) => (
        <li key={`${value}-${index}`} className="flex gap-2 text-xs leading-5 text-[#65786c]">
          <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-[#8da18b]" aria-hidden="true" />
          <span>{value}</span>
        </li>
      ))}
    </ul>
  ) : <p className="mt-2 text-xs leading-5 text-[#879389]">Не заполнено</p>;
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#89968b]">{label}</p>
      {children}
    </div>
  );
}

export default function EmployeeSectionsView({
  sections,
  currentModel,
}: {
  sections: EmployeeSections | null | undefined;
  currentModel: string | null;
}) {
  const workplace = sections?.workplace;
  const recommendation = sections?.modelRecommendation;

  return (
    <section className="mt-6 rounded-2xl border border-[#dce8dd] bg-[#f5f8f2] p-4 sm:p-5" aria-label="Описательные разделы сотрудника">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#718579]">Описательные сведения</p>
          <h4 className="mt-1 text-lg font-semibold tracking-[-0.04em] text-[#365341]">Рабочее место</h4>
        </div>
      </div>

      <div className="mt-4 grid gap-5 sm:grid-cols-2">
        <Detail label="Описание">
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#52685b]">{displayValue(workplace?.description)}</p>
        </Detail>
        <Detail label="Входы">
          <TextList values={workplace?.inputs ?? []} />
        </Detail>
        <Detail label="Результаты">
          <TextList values={workplace?.outputs ?? []} />
        </Detail>
        <Detail label="Ограничения">
          <TextList values={workplace?.limitations ?? []} />
        </Detail>
        <Detail label="Документы-источники">
          <TextList values={workplace?.sourceDocumentIds ?? []} />
        </Detail>
        <Detail label="Модель">
          <p className="mt-2 text-sm leading-6 text-[#405d4b]">Текущая: {displayValue(currentModel)}</p>
        </Detail>
      </div>

      {workplace?.laboratory && (
        <div className="mt-5 rounded-xl border border-[#dfe8dc] bg-[#fafbf7] p-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#89968b]">Лаборатория · {workplace.laboratory.title}</p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#52685b]">{workplace.laboratory.description}</p>
          <p className="mt-2 text-[10px] leading-4 text-[#89958b]">Документ: {displayValue(workplace.laboratory.documentId)}</p>
        </div>
      )}

      {recommendation ? (
        <div className="mt-5 rounded-xl border border-dashed border-[#cdd9ca] bg-[#eef3eb] p-4" aria-label="Предложенная модель, не включена">
          <div className="flex flex-wrap items-center gap-2">
            <h5 className="text-sm font-semibold text-[#4d6654]">Модель</h5>
            <span className="rounded-full border border-[#d4dfcf] bg-[#f8faf5] px-2 py-0.5 text-[10px] font-semibold text-[#748371]">Предложено · не включено</span>
          </div>
          <p className="mt-3 text-xs leading-5 text-[#65786c]">Предложение: {displayValue(recommendation.modelId)}</p>
          <p className="mt-1 text-xs leading-5 text-[#65786c]">Семейство: {displayValue(recommendation.family)}</p>
          <p className="mt-2 text-xs leading-5 text-[#65786c]">Обоснование: {displayValue(recommendation.rationale)}</p>
          <p className="mt-2 text-xs leading-5 text-[#819087]">Источник: {displayValue(recommendation.source)}</p>
        </div>
      ) : (
        <div className="mt-5 rounded-xl border border-dashed border-[#d8e1d6] bg-[#fafbf7] p-4">
          <p className="text-xs leading-5 text-[#879389]">Рекомендация модели: Не заполнено</p>
        </div>
      )}
    </section>
  );
}
