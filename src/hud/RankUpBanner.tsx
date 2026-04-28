/**
 * RankUpBanner — large center-screen announcement when combo rank advances.
 * Respects reduce-motion from settings (shorter, static).
 */

import {memo} from 'react';

export type RankUpEvent = {
  id: number;                 // unique per fire so React can re-mount
  rankId: string;             // D..SSS
  label: string;
  color: string;
  timestamp: number;
};

const RANK_COLORS: Record<string, string> = {
  D: '#aaaaaa', C: '#c0b090', B: '#d9a055',
  A: '#ffaa55', S: '#ff7744', SS: '#ff4488', SSS: '#00ddff',
};

export function rankColor(id: string): string { return RANK_COLORS[id] ?? '#ff7744'; }

export const RankUpBanner = memo(function RankUpBanner({event, reduceMotion}: {event: RankUpEvent | null; reduceMotion: boolean}) {
  if (!event) return null;
  return (
    <div
      key={event.id}
      className={`absolute top-[42%] left-0 right-0 z-[55] pointer-events-none text-center ${
        reduceMotion ? 'rank-up-static' : 'rank-up-sweep'
      }`}
    >
      <div
        className="font-[Cinzel] font-bold text-[64px] md:text-[88px] tracking-[0.25em] uppercase"
        style={{
          color: event.color,
          textShadow: `0 0 30px ${event.color}, 0 0 8px rgba(0,0,0,0.9)`,
        }}
      >
        {event.label}
      </div>
      <div
        className="font-[Cinzel] text-sm tracking-[0.4em] opacity-70 uppercase"
        style={{color: event.color}}
      >
        Rank {event.rankId}
      </div>
    </div>
  );
});
