// Strength-equipment makers, and the product lines people name them by.
//
// Weighted toward what turns up in American gyms: the old commercial and
// bodybuilding-gym makers that are still bolted to the floor in a lot of them
// (Cybex, Nautilus, Flex, Universal, Icarian, Paramount, Body Masters, MedX…),
// the big commercial ranges, and the plate-loaded brands hardcore gyms buy.
//
// Only makers of strength machines and benches. Cardio names are left out:
// "Assault bike" and "Stairmaster" are what the exercise is called, not a brand
// sitting on a movement.
//
// `aliases` are other ways plans write the maker. `lines` are product ranges;
// "Cybex Eagle leg extension" shows the leg extension with "Cybex Eagle" under
// it. `startOnly` marks names that could end a movement's name as an ordinary
// word, so they only count as a brand at the front.

export interface MachineMaker {
  name: string;
  aliases?: string[];
  lines?: string[];
  startOnly?: boolean;
}

export const MACHINE_MAKERS: MachineMaker[] = [
  // Old American commercial and bodybuilding-gym makers
  { name: 'Cybex', lines: ['Eagle NX', 'Eagle', 'VR1', 'VR2', 'VR3', 'Prestige', 'Bravo', 'Ion', 'Plate Loaded'] },
  { name: 'Nautilus', lines: ['Nitro Plus', 'Nitro', 'Next Generation', 'Xpload', 'Evo', '2ST', 'Impact', 'Inspiration', 'Leverage'] },
  { name: 'Flex Fitness', aliases: ['Flex'], startOnly: true },
  { name: 'Universal', lines: ['Centurion', 'Power Pak'] },
  { name: 'Icarian' },
  { name: 'Paramount' },
  { name: 'Body Masters', aliases: ['BodyMaster', 'BodyMasters', 'Body Master'] },
  { name: 'MedX', aliases: ['Med-X', 'Med X'] },
  { name: 'Magnum Fitness', aliases: ['Magnum'] },
  { name: 'Polaris' },
  { name: 'Trotter' },
  { name: 'Keiser', lines: ['Air300', 'A300', 'A250'] },
  { name: 'Southern Xercise' },
  { name: 'Tuff Stuff' },
  { name: 'Parabody' },
  { name: 'Muscle D', aliases: ['MuscleD'] },
  { name: 'Maxicam' },
  { name: 'Hoist', lines: ['Roc-It', 'HD'] },
  { name: 'Legend Fitness', aliases: ['Legend'], startOnly: true },
  { name: 'York', aliases: ['York Barbell'] },
  { name: 'Ivanko' },

  // Commercial ranges
  { name: 'Hammer Strength', lines: ['Iso-Lateral', 'Iso Lateral', 'Plate-Loaded', 'Plate Loaded', 'MTS', 'Select', 'Ground Base'] },
  { name: 'Life Fitness', lines: ['Signature Series', 'Signature', 'Insignia', 'Optima', 'Circuit Series', 'Pro2', 'Axiom'] },
  { name: 'Precor', lines: ['Discovery', 'Vitality', 'Resolute', 'Icarian'] },
  { name: 'Matrix', lines: ['Aura', 'Ultra', 'Versa', 'Magnum', 'Varsity'] },
  { name: 'Technogym', lines: ['Selection', 'Pure Strength', 'Element+', 'Element', 'Artis', 'Kinesis', 'Biostrength'] },
  { name: 'Star Trac', lines: ['Inspiration', 'Instinct', 'Leverage', 'Impact'] },
  { name: 'Freemotion', aliases: ['Free Motion'], lines: ['Epic', 'Genesis'] },
  { name: 'True Fitness' },
  { name: 'Body-Solid', aliases: ['Body Solid'] },
  { name: 'Powertec' },
  { name: 'Titan Fitness', aliases: ['Titan'], startOnly: true },

  // Plate-loaded and hardcore-gym brands
  { name: 'Prime', aliases: ['Prime Fitness'], lines: ['Plate Loaded', 'Hybrid'] },
  { name: 'Arsenal Strength', aliases: ['Arsenal'], lines: ['Reloaded', 'Alpha'] },
  { name: 'Nebula', aliases: ['Nebula Fitness'] },
  { name: 'Atlantis', lines: ['Precision'] },
  { name: 'Panatta', lines: ['Freeweight HP', 'Monolith', 'Fit Evo'] },
  { name: 'Gym80', aliases: ['Gym 80'], lines: ['Pure Kraft', 'Sygnum', '4E'] },
  { name: 'Newtech' },
  { name: 'Watson' },
  { name: 'Primal Strength', aliases: ['Primal'] },
  { name: 'Booty Builder' },
  { name: 'Glute Builder' },
  { name: 'Rogue', aliases: ['Rogue Fitness'] },
  { name: 'Sorinex' },
  { name: 'Elite FTS', aliases: ['EliteFTS'] },
  { name: 'BLK BOX', aliases: ['BLKBOX'] },
  { name: 'Hudson Steel' },
  { name: 'Strive', startOnly: true },
  { name: 'Pure Strength' },
  { name: 'Eleiko' },
  { name: 'MFG' },
  { name: 'Granite' },
  { name: 'Teca' },
];

/** Every maker's name, then every maker with each of its lines — the list a
 *  brand field offers as you type. */
export function brandSuggestions(): string[] {
  const out: string[] = [];
  for (const m of MACHINE_MAKERS) out.push(m.name);
  for (const m of MACHINE_MAKERS) {
    for (const line of m.lines ?? []) out.push(`${m.name} ${line}`);
  }
  return out;
}
