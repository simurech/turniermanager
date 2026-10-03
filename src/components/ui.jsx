import { useEffect, useRef } from 'react';

/**
 * Modaler Dialog oder Bottom-Sheet. Schliesst per Escape oder Tipp auf den Hintergrund, hält den Fokus
 * im Fenster und sperrt das Scrollen der Seite dahinter. `onClose` darf bei jedem Rendern neu sein.
 */
export function Dialog({ title, onClose, children, sheet = false, label }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const focusable = () => [...(ref.current?.querySelectorAll('input, button, select, a[href]') || [])].filter((el) => !el.disabled);
    const onKey = (e) => {
      if (e.key === 'Escape') closeRef.current?.();
      if (e.key === 'Tab') {
        const items = focusable();
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    focusable()[0]?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, []);
  return (
    <div className={`backdrop ${sheet ? '' : 'mid'}`} onPointerDown={(e) => e.target === e.currentTarget && closeRef.current?.()}>
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
