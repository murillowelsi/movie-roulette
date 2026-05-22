"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Loader2, RefreshCw } from "lucide-react";

const THRESHOLD = 70;
const MAX_PULL = 120;
const RESISTANCE = 2;
const MIN_TRIGGER_DY = 8;

export function PullToRefresh({ children }: { children: ReactNode }) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const pulling = useRef(false);
  const pullRef = useRef(0);
  const refreshingRef = useRef(false);

  useEffect(() => {
    pullRef.current = pull;
  }, [pull]);

  useEffect(() => {
    refreshingRef.current = refreshing;
  }, [refreshing]);

  useEffect(() => {
    const onTouchStart = (e: TouchEvent) => {
      if (refreshingRef.current) return;
      if (window.scrollY > 0) return;
      if (e.touches.length !== 1) return;
      startY.current = e.touches[0].clientY;
      pulling.current = true;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!pulling.current || startY.current === null) return;
      if (refreshingRef.current) return;
      const dy = e.touches[0].clientY - startY.current;
      if (dy <= 0) {
        if (pullRef.current !== 0) setPull(0);
        return;
      }
      const distance = Math.min(MAX_PULL, dy / RESISTANCE);
      setPull(distance);
      if (dy > MIN_TRIGGER_DY && e.cancelable) e.preventDefault();
    };

    const finish = () => {
      if (!pulling.current) return;
      pulling.current = false;
      startY.current = null;
      if (pullRef.current >= THRESHOLD && !refreshingRef.current) {
        setRefreshing(true);
        setPull(THRESHOLD);
        window.location.reload();
        return;
      }
      setPull(0);
    };

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", finish, { passive: true });
    document.addEventListener("touchcancel", finish, { passive: true });

    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", finish);
      document.removeEventListener("touchcancel", finish);
    };
  }, []);

  const showIndicator = pull > 0 || refreshing;
  const reachedThreshold = pull >= THRESHOLD;
  const rotation = Math.min(180, (pull / THRESHOLD) * 180);
  const opacity = Math.min(1, pull / THRESHOLD);
  const animating = !pulling.current && !refreshing;

  return (
    <div className="ptr-root flex flex-1 flex-col">
      <div
        aria-hidden={!showIndicator}
        className="pointer-events-none fixed inset-x-0 top-0 z-50 flex items-start justify-center"
        style={{
          height: refreshing ? THRESHOLD : pull,
          transition: animating ? "height 200ms ease" : undefined,
        }}
      >
        <div
          className="mt-3 flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-sm"
          style={{ opacity: refreshing ? 1 : opacity }}
        >
          {refreshing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw
              className="h-4 w-4"
              style={{
                transform: `rotate(${reachedThreshold ? 180 : rotation}deg)`,
                transition: animating ? "transform 150ms ease" : undefined,
              }}
            />
          )}
        </div>
      </div>

      <div
        className="flex flex-1 flex-col"
        style={{
          transform: `translateY(${refreshing ? THRESHOLD : pull}px)`,
          transition: animating ? "transform 200ms ease" : undefined,
        }}
      >
        {children}
      </div>
    </div>
  );
}
