import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BARS,
  STANDARD_PLATES_KG,
  totalKg,
  addPlate as addPlateTo,
  removePlateAt as removePlateAtIndex,
  removeOneOfSize as removeOneOfSizeFrom,
  setQuantityOfSize,
  groupPlates,
  getLastBarId,
  setLastBarId,
  getCustomBarKg,
  setCustomBarKg,
  getCustomPlates,
  addCustomPlate,
  type Bar,
} from '../lib/barbell';
import { hapticBuzz } from '../lib/haptics';

type Props = {
  open: boolean;
  initialKg?: number;
  onClose: () => void;
  onConfirm: (totalKg: number) => void;
};

const HEAVY_PLATES = [25, 20, 15, 10, 5];
const LIGHT_PLATES = [2.5, 1.25, 0.5];

function formatKg(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

type OutputMode = 'oneSide' | 'withBar' | 'withoutBar';

function getStoredOutputMode(): OutputMode | null {
  if (typeof window === 'undefined') return null;
  const v = window.localStorage.getItem('reps.calc.outputMode');
  return v === 'oneSide' || v === 'withBar' || v === 'withoutBar' ? v : null;
}

function validModesFor(barId: string): OutputMode[] {
  if (barId === 'none') return ['oneSide', 'withoutBar'];
  return ['oneSide', 'withBar', 'withoutBar'];
}

function defaultModeFor(barId: string): OutputMode {
  if (barId === 'none') return 'withoutBar';
  if (barId === 'custom') return 'oneSide';
  return 'withBar';
}

export default function BarbellCalculator({ open, onClose, onConfirm }: Props) {
  const [barId, setBarId] = useState<string>(() => getLastBarId() ?? 'none');
  const [customBarKg, setCustomBarKgState] = useState<number | null>(() => getCustomBarKg());
  const [plates, setPlates] = useState<number[]>([]);
  const [customPlates, setCustomPlates] = useState<number[]>(() => getCustomPlates());
  const [render, setRender] = useState(open);
  const [visible, setVisible] = useState(false);
  const [outputMode, setOutputMode] = useState<OutputMode>(() => {
    const stored = getStoredOutputMode();
    const lastBar = getLastBarId() ?? 'none';
    const valid = validModesFor(lastBar);
    if (stored && valid.includes(stored)) return stored;
    return defaultModeFor(lastBar);
  });

  function pickOutputMode(m: OutputMode) {
    setOutputMode(m);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('reps.calc.outputMode', m);
    }
    hapticBuzz(8);
  }

  useEffect(() => {
    if (open) {
      setRender(true);
      const id = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(id);
    }
    setVisible(false);
    const t = setTimeout(() => setRender(false), 300);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const bar: Bar = useMemo(() => {
    if (barId === 'custom') {
      return { id: 'custom', label: 'Other', weightKg: customBarKg ?? 20, icon: 'standard' };
    }
    if (barId === 'none') {
      return { id: 'none', label: 'None', weightKg: 0, icon: 'standard' };
    }
    return BARS.find((b) => b.id === barId) ?? BARS[0];
  }, [barId, customBarKg]);

  const { oneSide, total } = totalKg(bar.weightKg, plates);

  const [customBarDraft, setCustomBarDraft] = useState<string>('');

  function selectBar(id: string) {
    if (id === 'custom') {
      setBarId('custom');
      setCustomBarDraft(customBarKg ? String(customBarKg) : '');
      hapticBuzz(8);
      return;
    }
    setBarId(id);
    if (!validModesFor(id).includes(outputMode)) {
      const next = defaultModeFor(id);
      setOutputMode(next);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('reps.calc.outputMode', next);
      }
    }
    hapticBuzz(8);
  }

  function commitCustomBar(raw: string) {
    setCustomBarDraft(raw);
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return;
    setCustomBarKg(n);
    setCustomBarKgState(n);
  }

  function addPlate(kg: number) {
    setPlates((p) => addPlateTo(p, kg));
    hapticBuzz(12);
  }

  function removePlateAt(arrayIndex: number) {
    setPlates((p) => removePlateAtIndex(p, arrayIndex));
    hapticBuzz(10);
  }

  function removeOneOfSize(kg: number) {
    setPlates((p) => removeOneOfSizeFrom(p, kg));
    hapticBuzz(10);
  }

  function editQuantityForSize(kg: number) {
    const current = plates.filter((x) => x === kg).length;
    const raw = window.prompt(`How many ${formatKg(kg)}kg plates per side?`, String(current));
    if (raw == null) return;
    const n = Math.max(0, Math.min(20, Math.floor(Number(raw))));
    if (!Number.isFinite(n)) return;
    setPlates((p) => setQuantityOfSize(p, kg, n));
    hapticBuzz(12);
  }

  function addCustomPlatePrompt() {
    const raw = window.prompt('Custom plate weight (kg)', '7.5');
    if (raw == null) return;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return;
    const next = addCustomPlate(n);
    setCustomPlates(next);
    addPlate(n);
  }

  function handleConfirm() {
    setLastBarId(barId);
    hapticBuzz([10, 30, 10]);
    const chosen =
      outputMode === 'oneSide' ? oneSide : outputMode === 'withoutBar' ? oneSide * 2 : total;
    onConfirm(chosen);
    onClose();
  }

  if (!render) return null;

  const tiles: { id: string; label: string; weightKg: number; icon: 'easy' | 'standard' | 'other' | 'none' }[] = [
    { id: 'none', label: 'None', weightKg: 0, icon: 'none' },
    {
      id: 'custom',
      label: customBarKg ? `Other · ${formatKg(customBarKg)}kg` : 'Other',
      weightKg: customBarKg ?? 0,
      icon: 'other',
    },
    { id: 'mens', label: 'Olympic bar', weightKg: 25, icon: 'standard' },
    { id: 'womens', label: "Women's bar", weightKg: 15, icon: 'standard' },
    { id: 'easy', label: 'Easy bar', weightKg: 10, icon: 'easy' },
  ];

  const grouped = groupPlates(plates);
  const allCustomChoices = [...customPlates].filter((p) => !STANDARD_PLATES_KG.includes(p as (typeof STANDARD_PLATES_KG)[number]));

  return (
    <div
      className={`fixed inset-0 z-50 transition-opacity duration-300 ${
        visible ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
      aria-modal="true"
      role="dialog"
    >
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div
        className={`absolute inset-x-0 bottom-0 max-h-[92vh] overflow-y-auto rounded-t-3xl bg-paper shadow-card transition-transform duration-300 ease-out ${
          visible ? 'translate-y-0' : 'translate-y-full'
        }`}
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center pt-2">
          <div className="h-1 w-10 rounded-pill bg-line" />
        </div>

        <div className="relative grid grid-cols-[40px_1fr_40px] items-center px-3 py-3">
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-full text-ink active:opacity-70"
          >
            <CloseIcon />
          </button>
          <h2 className="text-center text-base font-semibold text-ink">Barbell calculator</h2>
          <span />
        </div>

        <div className="border-t border-line/60" />

        <div className="px-4 pt-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">
            Select barbell
          </div>
          <div className="mt-2 flex snap-x snap-mandatory gap-2 overflow-x-auto pb-1 [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: 'none' }}>
            {tiles.map((t) => {
              const selected = barId === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => selectBar(t.id)}
                  className={`relative flex h-[90px] w-[88px] flex-none snap-start flex-col items-center justify-between rounded-2xl bg-paper-card p-2 text-center transition-colors border-2 ${
                    selected ? 'border-ink' : 'border-line/60'
                  }`}
                >
                  {selected && (
                    <div className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-ink text-white">
                      <CheckIcon />
                    </div>
                  )}
                  <div className="flex h-10 w-full items-center justify-center">
                    <BarTileIcon kind={t.icon} />
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold leading-tight text-ink">{t.label.split(' · ')[0]}</div>
                    <div className="text-[10px] text-muted">
                      {t.icon === 'other'
                        ? customBarKg
                          ? `${formatKg(customBarKg)}kg`
                          : 'Tap to set'
                        : t.icon === 'none'
                          ? '0kg'
                          : `${t.weightKg}kg`}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
          {barId === 'custom' && (
            <div className="mt-2 flex items-center gap-2 rounded-2xl border-2 border-line/60 bg-paper-card p-3">
              <label className="text-xs font-semibold text-ink" htmlFor="custom-bar-kg">
                Bar weight
              </label>
              <input
                id="custom-bar-kg"
                type="number"
                inputMode="decimal"
                step="0.5"
                autoFocus
                placeholder="e.g. 20"
                value={customBarDraft}
                onChange={(e) => commitCustomBar(e.target.value)}
                className="w-24 rounded-xl border border-line bg-paper px-3 py-2 text-base font-semibold text-ink focus:border-ink focus:outline-none"
              />
              <span className="text-xs text-muted">kg</span>
            </div>
          )}
        </div>

        <div className="border-t border-line/60 mt-3" />

        <div className="px-4 pt-5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">
            Build your load (one side)
          </div>
          <div className="mt-1 text-xs text-muted">
            {plates.length === 0 ? 'Tap a plate to add it' : 'Tap a plate on the bar to remove it'}
          </div>

          <div
            className={`mt-4 grid items-center gap-3 ${
              plates.length === 0 ? 'grid-cols-1' : 'grid-cols-[1fr_140px]'
            }`}
          >
            <BarVisualisation plates={plates} onRemoveAt={removePlateAt} showBar={barId !== 'none'} />
            <ChipStack
              grouped={grouped}
              onTap={removeOneOfSize}
              onLongPress={editQuantityForSize}
            />
          </div>
        </div>

        <div className="px-4 pt-5">
          <div className="grid grid-cols-5 gap-2">
            {HEAVY_PLATES.map((kg) => (
              <PlateButton key={kg} kg={kg} variant="heavy" onClick={() => addPlate(kg)} />
            ))}
          </div>
          <div className="mt-3 grid grid-cols-5 gap-2">
            {LIGHT_PLATES.map((kg) => (
              <PlateButton key={kg} kg={kg} variant="light" onClick={() => addPlate(kg)} />
            ))}
            {allCustomChoices.slice(0, 1).map((kg) => (
              <PlateButton key={`custom-${kg}`} kg={kg} variant="light" onClick={() => addPlate(kg)} />
            ))}
            <button
              onClick={addCustomPlatePrompt}
              className="flex h-14 w-14 flex-col items-center justify-center justify-self-center rounded-full border border-dashed border-line text-ink active:opacity-70"
              aria-label="Add custom plate"
            >
              <PlusIcon />
              <span className="mt-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted">
                Other
              </span>
            </button>
          </div>
        </div>

        <div className="px-4 pt-5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">
            Tap to choose what to log
          </div>
          <div className={`mt-2 grid gap-2 ${barId === 'none' ? 'grid-cols-2' : 'grid-cols-3'}`}>
            <TotalButton
              label="One side"
              value={`${formatKg(oneSide)}kg`}
              active={outputMode === 'oneSide'}
              onClick={() => pickOutputMode('oneSide')}
            />
            {barId !== 'none' && (
              <TotalButton
                label="With bar"
                value={`${formatKg(total)}kg`}
                active={outputMode === 'withBar'}
                onClick={() => pickOutputMode('withBar')}
              />
            )}
            <TotalButton
              label={barId === 'none' ? 'Both sides' : 'Without bar'}
              value={`${formatKg(oneSide * 2)}kg`}
              active={outputMode === 'withoutBar'}
              onClick={() => pickOutputMode('withoutBar')}
            />
          </div>
        </div>

        <div className="sticky bottom-0 mt-3 bg-paper px-4 pb-4 pt-2">
          <button
            onClick={handleConfirm}
            className="w-full rounded-pill bg-ink py-4 text-sm font-semibold text-white active:opacity-80"
          >
            Confirm weight
          </button>
        </div>
      </div>
    </div>
  );
}

function TotalButton({
  label,
  value,
  active,
  onClick,
}: {
  label: string;
  value: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex flex-col items-start rounded-2xl p-3 text-left transition-colors border-2 ${
        active ? 'bg-ink border-ink' : 'bg-paper-card border-line/60 active:bg-paper-card/70'
      }`}
    >
      {active && (
        <div className="absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full bg-white text-ink">
          <CheckIcon dark />
        </div>
      )}
      <div
        className={`text-[10px] font-semibold uppercase tracking-wider ${
          active ? 'text-white/80' : 'text-muted'
        }`}
      >
        {label}
      </div>
      <div className={`mt-1 text-xl font-bold tracking-tight ${active ? 'text-white' : 'text-ink'}`}>
        {value}
      </div>
    </button>
  );
}

function PlateButton({ kg, variant, onClick }: { kg: number; variant: 'heavy' | 'light'; onClick: () => void }) {
  const heavy = variant === 'heavy';
  const label = formatKg(kg);
  // Longer labels ("1.25") shrink so they clear the rim.
  const numberPx = label.length >= 4 ? 12 : label.length === 3 ? 14 : 15;
  return (
    <button
      onClick={onClick}
      className={`relative h-14 w-14 justify-self-center rounded-full active:scale-95 transition-transform ${
        heavy
          ? 'bg-[linear-gradient(180deg,#3A3A3E_0%,#141416_55%,#050506_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_3px_6px_rgba(0,0,0,0.22)]'
          : 'border border-line bg-[linear-gradient(180deg,#FFFFFF_0%,#F2F2F5_60%,#E4E4E9_100%)] text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_2px_5px_rgba(0,0,0,0.10)]'
      }`}
      aria-label={`Add ${label}kg plate`}
    >
      {/* The raised face inside the plate's edge band, bounded by a fine ring. */}
      <span
        aria-hidden
        className={`pointer-events-none absolute inset-[4px] rounded-full border ${
          heavy
            ? 'border-white/12 bg-[linear-gradient(180deg,#303034_0%,#17171a_60%,#202024_100%)]'
            : 'border-ink/10 bg-[linear-gradient(180deg,#FFFFFF_0%,#F7F7FA_60%,#EFEFF3_100%)]'
        }`}
      />
      {/* Everything hangs off the centre hole: number above it, KG below it —
          so the hole stays exactly placed whatever the label's length. The
          number's anchor sits closer to the hole than it looks like it should
          because a leading-none box still carries ~3px below the baseline. */}
      <span
        className="absolute inset-x-0 text-center font-bold leading-none"
        style={{ bottom: 'calc(50% + 3px)', fontSize: numberPx }}
      >
        {label}
      </span>
      <span
        aria-hidden
        className={`absolute left-1/2 top-[calc(50%+1.5px)] h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full ${
          heavy
            ? 'border-[1.5px] border-white/90'
            : 'bg-[#C2C2C7] shadow-[inset_0_0.5px_1px_rgba(0,0,0,0.3)]'
        }`}
      />
      <span
        className={`absolute inset-x-0 text-center text-[9px] font-semibold leading-none tracking-wider ${
          heavy ? 'text-white/60' : 'text-muted'
        }`}
        style={{ top: 'calc(50% + 9.5px)' }}
      >
        KG
      </span>
    </button>
  );
}

function ChipStack({
  grouped,
  onTap,
  onLongPress,
}: {
  grouped: { kg: number; count: number }[];
  onTap: (kg: number) => void;
  onLongPress: (kg: number) => void;
}) {
  if (grouped.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {grouped.map(({ kg, count }) => (
        <Chip key={kg} kg={kg} count={count} onTap={() => onTap(kg)} onLongPress={() => onLongPress(kg)} />
      ))}
    </div>
  );
}

function Chip({
  kg,
  count,
  onTap,
  onLongPress,
}: {
  kg: number;
  count: number;
  onTap: () => void;
  onLongPress: () => void;
}) {
  const timerRef = useRef<number | null>(null);
  const firedLong = useRef(false);

  function start() {
    firedLong.current = false;
    timerRef.current = window.setTimeout(() => {
      firedLong.current = true;
      onLongPress();
    }, 500);
  }
  function cancel() {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }
  function end() {
    cancel();
    if (!firedLong.current) onTap();
  }

  return (
    <button
      onPointerDown={start}
      onPointerUp={end}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      className="flex items-center justify-between rounded-pill border border-line bg-paper-card px-2 py-1 text-xs active:opacity-70"
      aria-label={`${count} ${formatKg(kg)}kg plates — tap to remove one`}
    >
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ink text-[10px] font-bold text-white">
        {formatKg(kg)}
      </span>
      <span className="ml-2 mr-1 text-ink">× {count}</span>
    </button>
  );
}

function BarVisualisation({
  plates,
  onRemoveAt,
  showBar = true,
}: {
  plates: number[];
  onRemoveAt: (arrayIndex: number) => void;
  showBar?: boolean;
}) {
  const VIEW_H = 120;
  const cy = VIEW_H / 2;
  const gripW = showBar ? 74 : 0;
  const collarW = showBar ? 6 : 0;
  const endCapW = showBar ? 11 : 0;
  const plateGap = 1.5;
  const sleevePadLeft = showBar ? 5 : 0;
  const sleevePadRight = showBar ? 8 : 0;

  const platesWidth =
    plates.reduce((sum, kg) => sum + plateWidth(kg), 0) +
    Math.max(0, plates.length - 1) * plateGap;
  // A bare sleeve still needs room for the ghost plates that show where a
  // tapped plate lands.
  const emptySleeveW = showBar ? 62 : 20;
  const sleeveW = Math.max(emptySleeveW, platesWidth + sleevePadLeft + sleevePadRight);
  const VIEW_W = gripW + collarW + sleeveW + endCapW;
  const sleeveStart = gripW + collarW;
  const plateStart = sleeveStart + sleevePadLeft;
  const empty = plates.length === 0;

  return (
    // Height is fixed and the viewBox scales to fit inside it. Sizing by width
    // alone lets a short bar inherit its near-square aspect ratio and reserve a
    // screenful of empty space.
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      width="100%"
      height={148}
      preserveAspectRatio="xMidYMid meet"
      className="select-none"
    >
      <defs>
        {/* Vertical gradients read as a cylinder lit from above. */}
        <linearGradient id="bc-steel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#9A9AA0" />
          <stop offset="28%" stopColor="#EDEDF0" />
          <stop offset="55%" stopColor="#C4C4CA" />
          <stop offset="100%" stopColor="#86868B" />
        </linearGradient>
        <linearGradient id="bc-sleeve" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8E8E93" />
          <stop offset="30%" stopColor="#D8D8DD" />
          <stop offset="60%" stopColor="#A8A8AE" />
          <stop offset="100%" stopColor="#6E6E73" />
        </linearGradient>
        <linearGradient id="bc-plate" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4C4C50" />
          <stop offset="7%" stopColor="#2B2B2E" />
          <stop offset="24%" stopColor="#121214" />
          <stop offset="62%" stopColor="#0B0B0C" />
          <stop offset="88%" stopColor="#232326" />
          <stop offset="100%" stopColor="#424246" />
        </linearGradient>
        <linearGradient id="bc-plate-light" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="12%" stopColor="#F6F6F8" />
          <stop offset="55%" stopColor="#E9E9ED" />
          <stop offset="88%" stopColor="#F3F3F6" />
          <stop offset="100%" stopColor="#FDFDFE" />
        </linearGradient>
      </defs>

      {showBar && (
        <>
          {/* Grip, knurled so it reads as the end you hold. */}
          <rect x={0} y={cy - 5} width={gripW + 4} height={10} rx={5} fill="url(#bc-steel)" />
          {Array.from({ length: 9 }, (_, i) => (
            <line
              key={i}
              x1={14 + i * 5}
              y1={cy - 3.4}
              x2={14 + i * 5}
              y2={cy + 3.4}
              stroke="#6E6E73"
              strokeWidth={0.8}
              opacity={0.45}
            />
          ))}
          {/* Collar the plates butt up against. */}
          <rect x={gripW} y={cy - 13} width={collarW} height={26} rx={1.5} fill="url(#bc-sleeve)" />
          <rect
            x={gripW}
            y={cy - 13}
            width={collarW}
            height={26}
            rx={1.5}
            fill="none"
            stroke="#6E6E73"
            strokeWidth={0.6}
          />
          {/* One sleeve at a single diameter from collar to end — a real bar
              doesn't fatten out at the tip, and a wider cap read as a bolt
              head. The end is only a seam line and a soft highlight. */}
          <rect
            x={sleeveStart}
            y={cy - 7}
            width={sleeveW + endCapW}
            height={14}
            rx={2.5}
            fill="url(#bc-sleeve)"
          />
          <line
            x1={VIEW_W - endCapW}
            y1={cy - 6}
            x2={VIEW_W - endCapW}
            y2={cy + 6}
            stroke="#6E6E73"
            strokeWidth={0.7}
            opacity={0.7}
          />
          <rect
            x={VIEW_W - endCapW + 1}
            y={cy - 5}
            width={endCapW - 3}
            height={2}
            rx={1}
            fill="#FFFFFF"
            opacity={0.35}
          />
        </>
      )}

      {/* Where the next plates will land — only worth showing on a bare sleeve. */}
      {showBar && empty && (
        <g opacity={0.55}>
          {[25, 15, 5].map((kg, i) => {
            const w = plateWidth(kg);
            const h = plateHeight(kg);
            return (
              <rect
                key={kg}
                x={plateStart + i * (w + 3)}
                y={cy - h / 2}
                width={w}
                height={h}
                rx={4}
                fill="none"
                stroke="#C7C7CC"
                strokeWidth={1.2}
                strokeDasharray="5 4"
              />
            );
          })}
        </g>
      )}

      {(() => {
        let x = plateStart;
        return plates.map((kg, i) => {
          const w = plateWidth(kg);
          const h = plateHeight(kg);
          const y = cy - h / 2;
          const heavy = kg >= 5;
          const node = (
            <g
              key={`${i}-${kg}`}
              className="cursor-pointer"
              onClick={() => onRemoveAt(i)}
              role="button"
              aria-label={`Remove ${formatKg(kg)}kg plate`}
            >
              <rect
                x={x}
                y={y}
                width={w}
                height={h}
                rx={4}
                fill={heavy ? 'url(#bc-plate)' : 'url(#bc-plate-light)'}
                stroke={heavy ? '#000000' : '#B8B8BE'}
                strokeWidth={heavy ? 0.75 : 1}
              />
              {/* Rim highlight, so touching plates stay separable. */}
              <line
                x1={x + 1}
                y1={y + 4}
                x2={x + 1}
                y2={y + h - 4}
                stroke="#FFFFFF"
                strokeWidth={0.8}
                opacity={heavy ? 0.22 : 0.9}
              />
              {w >= 9 && (
                <text
                  x={x + w / 2}
                  y={cy + 3.5}
                  textAnchor="middle"
                  fontSize={w >= 13 ? 10 : 8.5}
                  fontWeight={700}
                  fill={heavy ? '#FFFFFF' : '#0A0A0A'}
                >
                  {formatKg(kg)}
                </text>
              )}
            </g>
          );
          x += w + plateGap;
          return node;
        });
      })()}
    </svg>
  );
}

function plateWidth(kg: number): number {
  if (kg >= 25) return 19;
  if (kg >= 20) return 18;
  if (kg >= 15) return 16;
  if (kg >= 10) return 14;
  if (kg >= 5) return 11;
  if (kg >= 2.5) return 8;
  if (kg >= 1.25) return 6;
  return 5;
}

function plateHeight(kg: number): number {
  if (kg >= 20) return 100;
  if (kg >= 15) return 92;
  if (kg >= 10) return 82;
  if (kg >= 5) return 68;
  if (kg >= 2.5) return 50;
  if (kg >= 1.25) return 42;
  return 36;
}

function BarTileIcon({ kind }: { kind: 'easy' | 'standard' | 'other' | 'none' }) {
  if (kind === 'easy') {
    return (
      <svg viewBox="0 0 60 24" width="56" height="24">
        <path
          d="M2 12 Q 10 4, 18 12 T 34 12 T 50 12 H 58"
          stroke="#0A0A0A"
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (kind === 'other') {
    return (
      <div className="flex items-center justify-center gap-0.5 text-ink">
        <span className="h-1 w-1 rounded-full bg-ink" />
        <span className="h-1 w-1 rounded-full bg-ink" />
        <span className="h-1 w-1 rounded-full bg-ink" />
      </div>
    );
  }
  if (kind === 'none') {
    return (
      <svg viewBox="0 0 60 24" width="56" height="24">
        <circle cx="30" cy="12" r="9" stroke="#0A0A0A" strokeWidth="2" fill="none" />
        <line x1="23" y1="19" x2="37" y2="5" stroke="#0A0A0A" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 60 24" width="56" height="24">
      <rect x="2" y="11" width="56" height="2" fill="#0A0A0A" />
      <rect x="14" y="6" width="2" height="12" fill="#0A0A0A" />
      <rect x="22" y="6" width="2" height="12" fill="#0A0A0A" />
      <rect x="36" y="6" width="2" height="12" fill="#0A0A0A" />
      <rect x="44" y="6" width="2" height="12" fill="#0A0A0A" />
    </svg>
  );
}

function CheckIcon({ dark }: { dark?: boolean } = {}) {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
      <path
        d="M5 12.5l4.5 4.5L19 7.5"
        stroke={dark ? '#0A0A0A' : 'white'}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
