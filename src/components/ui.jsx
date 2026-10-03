import { useEffect, useRef } from 'react';

/** Modaler Dialog oder Bottom-Sheet. Schliesst per Escape oder Tipp auf den Hintergrund. */
export function Dialog({ title, onClose, children, sheet = false, label }) {
  const ref = useRef(null);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    const previous = document.activeElement;
    ref.current?.querySelector('input, button, select')?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [onClose]);
  return (
    <div className={`backdrop ${sheet ? '' : 'mid'}`} onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div ref={ref} className={sheet ? 'sheet' : 'dialog'} role="dialog" aria-modal="true" aria-label={label || title}>
        {title && <h3>{title}</h3>}
        {children}
      </div>
    </div>
  );
}

export function Dots({ results }) {
  if (!results?.length) return null;
  const word = { W: 'Sieg', D: 'Remis', L: 'Niederlage' };
  return (
    <span className="dots" role="img" aria-label={`Form: ${results.map((r) => word[r]).join(', ')}`}>
      {results.map((r, i) => (
        <s key={i} className={r} />
      ))}
    </span>
  );
}

/** Zeigt Meister- und Verlierer-Marker eines Spielers. */
export function Marks({ player }) {
  if (!player) return null;
  return (
    <>
      {player.champion && <span className="tag">👑 Meister</span>}
      {player.loserMark && <span className="tag red">🍋 Verlierer</span>}
    </>
  );
}

export const Skeletons = ({ n = 3 }) => (
  <div aria-busy="true" aria-label="Lädt">
    {Array.from({ length: n }, (_, i) => (
      <div key={i} className="skeleton" />
    ))}
  </div>
);

export const Section = ({ children }) => <h2 className="section">{children}</h2>;

export function Switch({ checked, onChange, children }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="switch" onClick={() => onChange(!checked)}>
      <span>{children}</span>
      <span className="box" />
    </button>
  );
}

export function Segmented({ value, options, onChange, label }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
