'use client';

import { useEffect, useRef } from 'react';

type StillFrame = 'middle' | 'last';

export function LottieIcon({ src, className, loop = false, still = 'last' }: { src: string; className?: string; loop?: boolean; still?: StillFrame }) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = box.current;
    if (!node) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let cancelled = false;
    let destroy: (() => void) | null = null;

    (async () => {
      try {
        const [{ default: lottie }, res] = await Promise.all([import('lottie-web/build/player/lottie_light'), fetch(src)]);
        if (!res.ok || cancelled) return;
        const animationData: unknown = await res.json();
        if (cancelled) return;
        const anim = lottie.loadAnimation({ container: node, renderer: 'svg', loop: loop && !reduced, autoplay: !reduced, animationData });
        if (reduced) anim.goToAndStop(still === 'last' ? Math.max(0, anim.totalFrames - 1) : Math.floor(anim.totalFrames / 2), true);
        destroy = () => anim.destroy();
      } catch (err) {
        console.warn('lottie: the animation did not load', src, err);
      }
    })();

    return () => {
      cancelled = true;
      if (destroy) destroy();
    };
  }, [src, loop, still]);

  return <div ref={box} className={className} aria-hidden="true" />;
}
