export default function PitchColourTile({ on, toggle }: { on: boolean; toggle(): void }) {
  return <button type="button" className="ps-pitch-colour-tile" aria-label="Coloured notes" aria-pressed={on} title="Coloured notes" onClick={toggle}>
    <svg viewBox="0 0 36 36" aria-hidden="true"><text x="18" y="19" dominantBaseline="central" textAnchor="middle">C</text></svg>
  </button>;
}
