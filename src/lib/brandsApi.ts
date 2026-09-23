import { supabase, currentUserId } from './supabase';
import { cleanBrand, customBrandList, rememberBrands } from './exerciseBrand';

// Brands the user has typed that aren't on the known list. They're kept on the
// profile so a name like "Kraftwerk chest press" splits on every device, not just
// the one it was typed on. All of it is best effort: a brand that doesn't sync
// still lands in the name, which is what the machine's identity rests on.

/** Called with a profile row as it loads. */
export function adoptProfileBrands(row: unknown): void {
  const brands = (row as { machine_brands?: unknown } | null)?.machine_brands;
  if (Array.isArray(brands)) {
    rememberBrands(brands.filter((b): b is string => typeof b === 'string'));
  }
}

/** Remembers the brand typed alongside a new or renamed exercise. Nothing to do
 *  when it's blank, a known maker, or already remembered. */
export function rememberNewBrand(brand: string | null | undefined): void {
  const b = cleanBrand(brand);
  if (!b || !rememberBrands([b])) return;
  void saveBrands();
}

async function saveBrands(): Promise<void> {
  try {
    const userId = await currentUserId();
    if (!userId) return;
    // An update, not an upsert: the profile row exists once onboarding has run,
    // and a brand is no reason to create one. A database without 0020 answers
    // with an unknown-column error, which is fine to drop.
    await supabase
      .from('profiles')
      .update({ machine_brands: customBrandList() })
      .eq('user_id', userId);
  } catch {
    // Offline: the brand is still on this device and in the name.
  }
}
