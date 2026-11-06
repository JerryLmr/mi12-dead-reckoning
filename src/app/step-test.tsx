import { Accelerometer } from "expo-sensors";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

const INTERVAL_MS = 20; // 50 Hz demandé
const PEAK_THRESHOLD = 0.12; // g, valeur initiale à tester
const REARM_THRESHOLD = 0.02; // g
const MIN_STEP_INTERVAL_MS = 330;

export default function StepTest() {
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState(0);
  const [norm, setNorm] = useState(1);
  const [filtered, setFiltered] = useState(0);
  const [duration, setDuration] = useState(0);

  const runningRef = useRef(false);
  const stepsRef = useRef(0);
  const startTimeRef = useRef(0);
  const lastStepRef = useRef(0);
  const lastDisplayRef = useRef(0);
  const armedRef = useRef(true);
  const bufferRef = useRef<number[]>([]);

  useEffect(() => {
    Accelerometer.setUpdateInterval(INTERVAL_MS);

    const subscription = Accelerometer.addListener(({ x, y, z }) => {
      const now = Date.now();
      const magnitude = Math.sqrt(x * x + y * y + z * z);

      if (!runningRef.current) {
        if (now - lastDisplayRef.current >= 100) {
          setNorm(magnitude);
          lastDisplayRef.current = now;
        }
        return;
      }

      // Signal centré approximativement autour de 0 g
      const signal = magnitude - 1;

      // Moyenne glissante sur 5 échantillons
      const buffer = bufferRef.current;
      buffer.push(signal);

      if (buffer.length > 5) {
        buffer.shift();
      }

      const smoothed =
        buffer.reduce((sum, value) => sum + value, 0) / buffer.length;

      // Détecteur à seuil avec réarmement
      if (
        armedRef.current &&
        smoothed >= PEAK_THRESHOLD &&
        now - lastStepRef.current >= MIN_STEP_INTERVAL_MS
      ) {
        stepsRef.current += 1;
        lastStepRef.current = now;
        armedRef.current = false;
        setSteps(stepsRef.current);
      }

      if (smoothed <= REARM_THRESHOLD) {
        armedRef.current = true;
      }

      // Affichage limité à environ 10 Hz
      if (now - lastDisplayRef.current >= 100) {
        setNorm(magnitude);
        setFiltered(smoothed);
        setDuration((now - startTimeRef.current) / 1000);
        lastDisplayRef.current = now;
      }
    });

    return () => subscription.remove();
  }, []);

  const resetDetector = () => {
    stepsRef.current = 0;
    lastStepRef.current = 0;
    armedRef.current = true;
    bufferRef.current = [];

    setSteps(0);
    setFiltered(0);
    setDuration(0);
  };

  const start = () => {
    resetDetector();
    startTimeRef.current = Date.now();
    runningRef.current = true;
    setRunning(true);
  };

  const stop = () => {
    runningRef.current = false;
    setRunning(false);
    setDuration((Date.now() - startTimeRef.current) / 1000);
  };

  const reset = () => {
    runningRef.current = false;
    setRunning(false);
    resetDetector();
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>MI12 · Détection de pas</Text>

      <Text style={styles.subtitle}>Prototype V0 — Détection par seuil</Text>

      <View style={styles.counter}>
        <Text style={styles.counterNumber}>{steps}</Text>
        <Text style={styles.counterLabel}>Pas détectés</Text>
      </View>

      <View style={styles.data}>
        <Text>État : {running ? "Enregistrement" : "Arrêt"}</Text>
        <Text>Durée : {duration.toFixed(1)} s</Text>
        <Text>Norme : {norm.toFixed(3)} g</Text>
        <Text>Signal filtré : {filtered.toFixed(3)} g</Text>
      </View>

      <View style={styles.buttons}>
        <Pressable
          style={[styles.button, styles.startButton]}
          onPress={start}
          disabled={running}
        >
          <Text style={styles.buttonText}>Start</Text>
        </Pressable>

        <Pressable
          style={[styles.button, styles.stopButton]}
          onPress={stop}
          disabled={!running}
        >
          <Text style={styles.buttonText}>Stop</Text>
        </Pressable>

        <Pressable style={[styles.button, styles.resetButton]} onPress={reset}>
          <Text style={styles.buttonText}>Reset</Text>
        </Pressable>
      </View>

      <Text style={styles.note}>
        Tenir le téléphone dans une orientation fixe par rapport au corps
        pendant la marche.
      </Text>

      <Text style={styles.note}>
        Seuil : {PEAK_THRESHOLD} g · Intervalle minimal : {MIN_STEP_INTERVAL_MS}{" "}
        ms
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#ffffff",
    padding: 20,
    gap: 16,
  },
  title: {
    fontSize: 23,
    fontWeight: "bold",
  },
  subtitle: {
    fontSize: 14,
    color: "#64748b",
  },
  counter: {
    alignItems: "center",
    paddingVertical: 28,
    borderRadius: 14,
    backgroundColor: "#eff6ff",
  },
  counterNumber: {
    fontSize: 80,
    fontWeight: "bold",
    color: "#2563eb",
  },
  counterLabel: {
    fontSize: 18,
    color: "#334155",
  },
  data: {
    backgroundColor: "#f1f5f9",
    padding: 18,
    borderRadius: 12,
    gap: 10,
  },
  buttons: {
    flexDirection: "row",
    gap: 8,
  },
  button: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  startButton: {
    backgroundColor: "#16a34a",
  },
  stopButton: {
    backgroundColor: "#dc2626",
  },
  resetButton: {
    backgroundColor: "#475569",
  },
  buttonText: {
    color: "white",
    fontWeight: "bold",
  },
  note: {
    fontSize: 13,
    color: "#64748b",
    lineHeight: 20,
  },
});
