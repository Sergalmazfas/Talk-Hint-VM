import { FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type PersonalityStatus = "available" | "retired";
export type PersonalityEditorFields = {
  slug: string;
  name: string;
  description: string;
  rules: string;
  examples: string;
  personal: string;
  work: string;
  status: PersonalityStatus;
};

export function SecretaryPersonalityEditor({
  editor,
  editingId,
  saving,
  onChange,
  onClose,
  onSave,
}: {
  editor: PersonalityEditorFields;
  editingId: string | null;
  saving: boolean;
  onChange: (fields: PersonalityEditorFields) => void;
  onClose: () => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const set = (field: keyof PersonalityEditorFields, value: string) => onChange({ ...editor, [field]: value });
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[#071215]/85 p-4 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-labelledby="personality-editor-title" className="mx-auto my-6 max-w-3xl rounded-2xl border border-[#45615d] bg-[#17282d] p-5 shadow-2xl sm:p-7">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.15em] text-teal-300">{editingId ? "Новая версия" : "Новая запись"}</p>
            <h2 id="personality-editor-title" className="mt-1 text-2xl font-semibold">{editingId ? "Редактировать характер" : "Создать характер"}</h2>
            <p className="mt-2 text-sm text-[#a9bbb7]">Публикация создаёт версию. Существующие назначения не меняются.</p>
          </div>
          <Button variant="ghost" onClick={onClose} className="text-[#a9bbb7]">Закрыть</Button>
        </div>
        <form onSubmit={onSave} className="space-y-4">
          {!editingId && <div className="space-y-2"><Label htmlFor="personality-slug" className="text-[#dce8e4]">Slug</Label><Input id="personality-slug" required value={editor.slug} onChange={(event) => set("slug", event.target.value)} className="border-[#40585c] bg-[#102025] text-white" /></div>}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="personality-name" className="text-[#dce8e4]">Имя</Label><Input id="personality-name" required value={editor.name} onChange={(event) => set("name", event.target.value)} className="border-[#40585c] bg-[#102025] text-white" /></div>
            <div className="space-y-2"><Label htmlFor="personality-status" className="text-[#dce8e4]">Статус</Label><select id="personality-status" value={editor.status} onChange={(event) => set("status", event.target.value)} className="h-10 w-full rounded-md border border-[#40585c] bg-[#102025] px-3 text-sm text-white"><option value="available">Доступен для выбора</option><option value="retired">В архиве</option></select></div>
          </div>
          <div className="space-y-2"><Label htmlFor="personality-description" className="text-[#dce8e4]">Краткое описание</Label><Textarea id="personality-description" value={editor.description} onChange={(event) => set("description", event.target.value)} className="border-[#40585c] bg-[#102025] text-white" /></div>
          <div className="space-y-2"><Label htmlFor="personality-rules" className="text-[#dce8e4]">Правила</Label><Textarea id="personality-rules" required value={editor.rules} onChange={(event) => set("rules", event.target.value)} className="min-h-28 border-[#40585c] bg-[#102025] text-white" /></div>
          <div className="space-y-2"><Label htmlFor="personality-examples" className="text-[#dce8e4]">Примеры · по одному на строку</Label><Textarea id="personality-examples" value={editor.examples} onChange={(event) => set("examples", event.target.value)} className="min-h-24 border-[#40585c] bg-[#102025] text-white" /></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="personality-personal" className="text-[#dce8e4]">Рекомендации для Personal</Label><Textarea id="personality-personal" value={editor.personal} onChange={(event) => set("personal", event.target.value)} className="min-h-24 border-[#40585c] bg-[#102025] text-white" /></div>
            <div className="space-y-2"><Label htmlFor="personality-work" className="text-[#dce8e4]">Рекомендации для Work</Label><Textarea id="personality-work" value={editor.work} onChange={(event) => set("work", event.target.value)} className="min-h-24 border-[#40585c] bg-[#102025] text-white" /></div>
          </div>
          <div className="flex flex-col-reverse justify-end gap-2 border-t border-[#30474b] pt-4 sm:flex-row">
            <Button type="button" variant="ghost" onClick={onClose} className="text-[#b6cbc5]">Отмена</Button>
            <Button type="submit" disabled={saving} className="bg-[#28756a] text-white hover:bg-[#328b7c]">{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{editingId ? "Сохранить новую версию" : "Создать v1"}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
