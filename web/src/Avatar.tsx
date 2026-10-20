import { type ReactNode, useEffect, useState } from 'react';

const PALETTE = ['#f26b3a', '#f5a524', '#3fbf7f', '#3b9eff', '#a07cf7', '#ef5da8', '#2dc2c2', '#e8e8e8'];

function hash(text: string): number {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return h;
}

interface Props {
  id: string;
  name: string;
  url?: string | null;
  size?: 'sm' | 'md' | 'lg';
  badge?: ReactNode;
}

export function Avatar({ id, name, url, size = 'md', badge }: Props) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [url]);
  if (url && !broken) {
    return (
      <span className={`avatar ${size}`} aria-hidden="true">
        <img className="avatar-image" src={url} alt="" onError={() => setBroken(true)} />
        {badge}
      </span>
    );
  }
  const color = PALETTE[hash(id) % PALETTE.length];
  const initial = [...name.trim()][0]?.toUpperCase() ?? '?';
  return (
    <span className={`avatar ${size}`} style={{ background: color }} aria-hidden="true">
      <span className="avatar-initial">{initial}</span>
      {badge}
    </span>
  );
}
