"use client";
// Small, dependency-free motion toolkit: a material-ish ripple, a FLIP layout
// helper (items glide when the list reorders), an exit "ghost", and a count-up.
// Everything respects the user's prefers-reduced-motion setting.
import { useEffect, useLayoutEffect, useRef, useState } from "react";

// Timings mirror the CSS motion tokens in app/globals.css.
export const MOTION = {
  enter: 280,
  move: 320,
  exit: 220,
  easeOut: "cubic-bezier(.22,.61,.36,1)",
};

// useLayoutEffect warns during SSR; fall back to useEffect on the server.
export const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function prefersReducedMotion() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
}

/* ------------------------------- ripple -------------------------------- */
// Delegated pointer listener: injects a short-lived ripple span into the
// pressed control. No per-button wiring needed.
export function useRipple() {
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const onDown = (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const host = e.target?.closest?.("button, .btn, .mug, .mugrow, .matchcard, .pickitem, .dealrow, .listrow");
      if (!host || host.disabled || host.dataset.noRipple != null) return;
      const rect = host.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const size = Math.max(rect.width, rect.height) * 2;
      const span = document.createElement("span");
      span.className = "ripple";
      span.style.width = span.style.height = size + "px";
      span.style.left = e.clientX - rect.left - size / 2 + "px";
      span.style.top = e.clientY - rect.top - size / 2 + "px";
      host.appendChild(span);
      const done = () => span.remove();
      span.addEventListener("animationend", done, { once: true });
      window.setTimeout(done, 800);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);
}

/* -------------------------------- FLIP --------------------------------- */
// Animate children of `containerRef` from their previous positions to their new
// ones whenever `signature` changes. Newly added keys fade/slide in; the first
// commit after mount is left alone (so initial page load stays calm).
export function useFlip(containerRef, signature) {
  const prev = useRef(new Map());
  const first = useRef(true);
  useIsoLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) { first.current = false; return; }
    const reduce = prefersReducedMotion();
    const next = new Map();
    el.querySelectorAll("[data-flip-key]").forEach((node) => {
      const key = node.getAttribute("data-flip-key");
      if (!key) return;
      const rect = node.getBoundingClientRect();
      next.set(key, rect);
      if (reduce) return;
      node.getAnimations?.().forEach((a) => a.cancel());
      const before = prev.current.get(key);
      if (before) {
        const dx = before.left - rect.left;
        const dy = before.top - rect.top;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
          node.animate(
            [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
            { duration: MOTION.move, easing: MOTION.easeOut }
          );
        }
      } else if (!first.current) {
        node.animate(
          [{ opacity: 0, transform: "translateY(-10px) scale(.97)" }, { opacity: 1, transform: "none" }],
          { duration: MOTION.enter, easing: MOTION.easeOut }
        );
      }
    });
    prev.current = next;
    first.current = false;
  }, [signature]);
}

// Clone a just-removed element, pin it in place and let it fade away while the
// rest of the list reflows underneath. Call this right before removing the item
// from state (with the element's live bounding rect).
export function animateGhost(node, rect) {
  if (!node || !rect || typeof document === "undefined" || prefersReducedMotion()) return;
  const clone = node.cloneNode(true);
  clone.removeAttribute("data-flip-key");
  clone.removeAttribute("data-mug-id");
  clone.setAttribute("aria-hidden", "true");
  Object.assign(clone.style, {
    position: "fixed",
    left: rect.left + "px",
    top: rect.top + "px",
    width: rect.width + "px",
    height: rect.height + "px",
    margin: "0",
    pointerEvents: "none",
    zIndex: "55",
    willChange: "transform, opacity",
  });
  document.body.appendChild(clone);
  const anim = clone.animate(
    [{ opacity: 1, transform: "scale(1)" }, { opacity: 0, transform: "scale(.92)" }],
    { duration: MOTION.exit, easing: "ease-in", fill: "forwards" }
  );
  const done = () => clone.remove();
  anim.onfinish = done;
  anim.oncancel = done;
  window.setTimeout(done, MOTION.exit + 150);
}

/* ------------------------------ count-up ------------------------------- */
// Animate a number from 0 to `value` on mount (used by the stats dialog).
export function useCountUp(value, duration = 700) {
  const target = Number(value) || 0;
  const [n, setN] = useState(() => (prefersReducedMotion() ? target : 0));
  useEffect(() => {
    if (prefersReducedMotion()) { setN(target); return; }
    let raf;
    const start = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setN(Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return n;
}
