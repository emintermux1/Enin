"use client";

import { useState } from "react";
import styles from "./Calculator.module.css";

export default function Calculator() {
  const [display, setDisplay] = useState("0");
  const [previousValue, setPreviousValue] = useState<string | null>(null);
  const [operation, setOperation] = useState<string | null>(null);
  const [resetDisplay, setResetDisplay] = useState(false);

  function calculate(a: number, op: string, b: number): string {
    switch (op) {
      case "+":
        return String(a + b);
      case "-":
        return String(a - b);
      case "×":
        return String(a * b);
      case "÷":
        if (b === 0) return "Hata";
        return String(a / b);
      default:
        return String(b);
    }
  }

  function handleNumber(num: string) {
    if (display === "Hata") {
      setDisplay(num);
      return;
    }
    if (resetDisplay) {
      setDisplay(num);
      setResetDisplay(false);
      return;
    }
    if (display === "0" && num !== ".") {
      setDisplay(num);
    } else {
      setDisplay(display + num);
    }
  }

  function handleOperation(op: string) {
    if (display === "Hata") return;
    if (previousValue !== null && operation && !resetDisplay) {
      const result = calculate(
        parseFloat(previousValue),
        operation,
        parseFloat(display)
      );
      if (result === "Hata") {
        setDisplay("Hata");
        setPreviousValue(null);
        setOperation(null);
        setResetDisplay(true);
        return;
      }
      setPreviousValue(result);
      setDisplay(result);
    } else {
      setPreviousValue(display);
    }
    setOperation(op);
    setResetDisplay(true);
  }

  function handleEquals() {
    if (previousValue === null || operation === null || display === "Hata")
      return;
    const result = calculate(
      parseFloat(previousValue),
      operation,
      parseFloat(display)
    );
    setDisplay(result);
    setPreviousValue(null);
    setOperation(null);
    setResetDisplay(true);
  }

  function handleClear() {
    setDisplay("0");
    setPreviousValue(null);
    setOperation(null);
    setResetDisplay(false);
  }

  function handleToggleSign() {
    if (display === "Hata" || display === "0") return;
    if (display.startsWith("-")) {
      setDisplay(display.slice(1));
    } else {
      setDisplay("-" + display);
    }
  }

  function handlePercent() {
    if (display === "Hata") return;
    setDisplay(String(parseFloat(display) / 100));
  }

  function handleDecimal() {
    if (display === "Hata") return;
    if (resetDisplay) {
      setDisplay("0.");
      setResetDisplay(false);
      return;
    }
    if (!display.includes(".")) {
      setDisplay(display + ".");
    }
  }

  return (
    <div className={styles.calculator}>
      <div className={styles.display}>{display}</div>
      <div className={styles.buttons}>
        <button
          className={`${styles.button} ${styles.topRowButton}`}
          onClick={handleClear}
        >
          C
        </button>
        <button
          className={`${styles.button} ${styles.topRowButton}`}
          onClick={handleToggleSign}
        >
          ±
        </button>
        <button
          className={`${styles.button} ${styles.topRowButton}`}
          onClick={handlePercent}
        >
          %
        </button>
        <button
          className={`${styles.button} ${styles.operatorButton}`}
          onClick={() => handleOperation("÷")}
        >
          ÷
        </button>

        <button className={styles.button} onClick={() => handleNumber("7")}>
          7
        </button>
        <button className={styles.button} onClick={() => handleNumber("8")}>
          8
        </button>
        <button className={styles.button} onClick={() => handleNumber("9")}>
          9
        </button>
        <button
          className={`${styles.button} ${styles.operatorButton}`}
          onClick={() => handleOperation("×")}
        >
          ×
        </button>

        <button className={styles.button} onClick={() => handleNumber("4")}>
          4
        </button>
        <button className={styles.button} onClick={() => handleNumber("5")}>
          5
        </button>
        <button className={styles.button} onClick={() => handleNumber("6")}>
          6
        </button>
        <button
          className={`${styles.button} ${styles.operatorButton}`}
          onClick={() => handleOperation("-")}
        >
          -
        </button>

        <button className={styles.button} onClick={() => handleNumber("1")}>
          1
        </button>
        <button className={styles.button} onClick={() => handleNumber("2")}>
          2
        </button>
        <button className={styles.button} onClick={() => handleNumber("3")}>
          3
        </button>
        <button
          className={`${styles.button} ${styles.operatorButton}`}
          onClick={() => handleOperation("+")}
        >
          +
        </button>

        <button
          className={`${styles.button} ${styles.zeroButton}`}
          onClick={() => handleNumber("0")}
        >
          0
        </button>
        <button className={styles.button} onClick={handleDecimal}>
          .
        </button>
        <button
          className={`${styles.button} ${styles.equalsButton}`}
          onClick={handleEquals}
        >
          =
        </button>
      </div>
    </div>
  );
}
