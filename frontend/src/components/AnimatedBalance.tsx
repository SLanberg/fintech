"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import styles from "./AnimatedBalance.module.css";

interface AnimatedBalanceProps {
  value: number;
  show?: boolean;
  className?: string;
}

const ROLL_STEPS = 6; // How many digits roll down from top

function AnimatedDigit({
  targetDigit,
  staggerIndex,
  animKey,
  isAnimating,
}: {
  targetDigit: number;
  staggerIndex: number;
  animKey: number;
  isAnimating: boolean;
}) {
  const sequence = useMemo(() => {
    const list: number[] = [];
    for (let i = 0; i < ROLL_STEPS; i++) {
      list.push((targetDigit - i + 100) % 10);
    }
    return list;
  }, [targetDigit]);

  // When not animating, render the static digit directly
  if (!isAnimating) {
    return (
      <span className={styles.digitSlot}>
        <span className={styles.digitColumn}>
          <span className={styles.digitItem}>{targetDigit}</span>
        </span>
      </span>
    );
  }

  // Cascade delay: digits tumble down in a wave from left to right
  const delayMs = staggerIndex * 40;
  const rollFromOffset = `-${ROLL_STEPS - 1}em`;

  return (
    <span className={styles.digitSlot}>
      <span
        key={`col-${animKey}-${targetDigit}`}
        className={`${styles.digitColumn} ${styles.digitAnimated}`}
        style={
          {
            "--roll-from": rollFromOffset,
            animationDelay: `${delayMs}ms`,
          } as React.CSSProperties
        }
      >
        {sequence.map((d, i) => (
          <span key={i} className={styles.digitItem}>
            {d}
          </span>
        ))}
      </span>
    </span>
  );
}

// Module-level cache so tab switching / unmounting doesn't re-trigger animation
let lastKnownBalance: number | null = null;

export function AnimatedBalance({
  value,
  show = true,
  className = "",
}: AnimatedBalanceProps) {
  const [animKey, setAnimKey] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const [addedAmount, setAddedAmount] = useState<number | null>(null);
  const animTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Trigger cascade roll ONLY when value actually changes
  useEffect(() => {
    // If it's the very first time we see any balance value, initialize without animating
    if (lastKnownBalance === null) {
      lastKnownBalance = value;
      return;
    }

    // If balance is identical (e.g. tab switched or re-rendered), do NOT animate
    if (value === lastKnownBalance) {
      return;
    }

    // Actual balance change detected
    const diff = value - lastKnownBalance;
    lastKnownBalance = value;

    if (diff > 0) {
      setAddedAmount(diff);
    } else {
      setAddedAmount(null);
    }

    setIsAnimating(true);
    setAnimKey((k) => k + 1);

    if (animTimerRef.current) {
      clearTimeout(animTimerRef.current);
    }
    animTimerRef.current = setTimeout(() => {
      setIsAnimating(false);
    }, 1100);
  }, [value]);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (animTimerRef.current) {
        clearTimeout(animTimerRef.current);
      }
    };
  }, []);

  // Clear the added amount chip after animation finishes
  useEffect(() => {
    if (addedAmount !== null) {
      const timer = setTimeout(() => {
        setAddedAmount(null);
      }, 1800);
      return () => clearTimeout(timer);
    }
  }, [addedAmount]);

  if (!show) {
    return <span className={className}>••••••••</span>;
  }

  const formatted = value.toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const characters = formatted.split("");
  let digitIndex = 0;

  return (
    <span
      className={`${className} ${styles.balanceWrapper} ${
        addedAmount ? styles.balanceAdded : ""
      }`}
    >
      {addedAmount !== null && addedAmount > 0 && (
        <span className={styles.depositChip}>
          +€
          {addedAmount.toLocaleString("de-DE", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        </span>
      )}

      {characters.map((char, index) => {
        const isDigit = /^[0-9]$/.test(char);
        if (!isDigit) {
          return (
            <span key={`sep-${index}`} className={styles.separator}>
              {char}
            </span>
          );
        }

        const currentDigitIndex = digitIndex++;
        const targetDigit = parseInt(char, 10);

        return (
          <AnimatedDigit
            key={`d-${index}-${animKey}`}
            targetDigit={targetDigit}
            staggerIndex={currentDigitIndex}
            animKey={animKey}
            isAnimating={isAnimating}
          />
        );
      })}
    </span>
  );
}
