"use client";

import { useReducedMotion, type Transition, type Variants } from "motion/react";

// Standard duration scale
export const MOTION_DURATIONS = {
  micro: 0.12,      // 120ms - buttons, toggles
  hover: 0.16,      // 160ms - card hover, list hover
  transition: 0.22, // 220ms - modals, dropdowns
  page: 0.28,       // 280ms - page tab transitions
  chart: 0.45,      // 450ms - chart reveals
};

// Subtle smooth easing curve (cubic bezier)
export const MOTION_EASE = [0.16, 1, 0.3, 1] as const;

export const defaultTransition: Transition = {
  duration: MOTION_DURATIONS.transition,
  ease: MOTION_EASE,
};

// Reusable Motion Variants
export const pageVariants: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: MOTION_DURATIONS.page, ease: MOTION_EASE } },
  exit: { opacity: 0, y: -6, transition: { duration: 0.15 } },
};

export const modalBackdropVariants: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

export const modalContentVariants: Variants = {
  initial: { opacity: 0, scale: 0.96, y: 12 },
  animate: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { duration: 0.24, ease: MOTION_EASE },
  },
  exit: { opacity: 0, scale: 0.97, y: 8, transition: { duration: 0.15 } },
};

export const cardStaggerContainer: Variants = {
  initial: {},
  animate: {
    transition: {
      staggerChildren: 0.04,
    },
  },
};

export const cardItemVariants: Variants = {
  initial: { opacity: 0, y: 10 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.24, ease: MOTION_EASE },
  },
};

export const hoverMicroInteraction = {
  scale: 1.015,
  transition: { duration: MOTION_DURATIONS.hover, ease: "easeOut" },
};

export const tapMicroInteraction = {
  scale: 0.98,
  transition: { duration: MOTION_DURATIONS.micro },
};

// Helper hook that returns motion properties disabled if reduced motion is preferred
export function useAppMotion() {
  const prefersReduced = useReducedMotion();

  return {
    prefersReduced,
    pageProps: prefersReduced ? {} : { variants: pageVariants, initial: "initial", animate: "animate", exit: "exit" },
    cardHover: prefersReduced ? {} : { whileHover: hoverMicroInteraction, whileTap: tapMicroInteraction },
    buttonTap: prefersReduced ? {} : { whileTap: tapMicroInteraction },
  };
}
