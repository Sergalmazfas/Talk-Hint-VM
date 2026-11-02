type Caption = { translation: string; providerUsed: string };

/** The guest's dialogue translation is independent of hint generation/translation. */
export async function deliverGuestCaption(
  translation: Promise<Caption>,
  deps: {
    closed: () => boolean;
    translationAllowed: () => Promise<boolean>;
    emit: (caption: Caption) => void;
    failed: () => void;
  },
): Promise<void> {
  const caption = await translation.catch(() => {
    deps.failed();
    return { translation: "", providerUsed: "translation_error" };
  });
  if (deps.closed()) return;
  const allowed = await deps.translationAllowed().catch(() => false);
  if (deps.closed()) return;
  deps.emit(allowed ? caption : { ...caption, translation: "" });
}
