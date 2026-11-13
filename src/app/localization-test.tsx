import * as Location from "expo-location";
import { Accelerometer } from "expo-sensors";
import { useEffect, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

// V0 — Détection des pas
const INTERVAL_MS = 20;
const PEAK_THRESHOLD = 0.12;
const REARM_THRESHOLD = 0.02;
const MIN_STEP_INTERVAL_MS = 330;
const MOVING_AVERAGE_SIZE = 5;

// V1.1 — Localisation
const STEP_LENGTH_M = 0.7;

type Position = {
  x: number;
  y: number;
};

const ORIGIN: Position = { x: 0, y: 0 };

function normalizeHeading(angle: number): number {
  return ((angle % 360) + 360) % 360;
}

function distance(a: Position, b: Position): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

// Affichage d'une trajectoire 2D en mètres
function TrajectoryChart({ trajectory }: { trajectory: Position[] }) {
  const { width } = useWindowDimensions();
  const size = Math.min(width - 48, 350);
  const padding = 24;
  const center = size / 2;

  const maxCoordinate = Math.max(
    5,
    ...trajectory.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y))),
  );

  // Même échelle pour X et Y : pas de déformation.
  const range = maxCoordinate * 1.2;
  const pixelsPerMeter = (size - 2 * padding) / (2 * range);

  function project(p: Position) {
    return {
      px: center + p.x * pixelsPerMeter,
      py: center - p.y * pixelsPerMeter,
    };
  }

  const start = project(trajectory[0] ?? ORIGIN);
  const end = project(trajectory[trajectory.length - 1] ?? ORIGIN);

  return (
    <View style={styles.chartCard}>
      <Text style={styles.sectionTitle}>Trajectoire estimée</Text>

      <Text style={styles.hint}>Vue de dessus · X Est · Y Nord</Text>

      <View style={[styles.plot, { width: size, height: size }]}>
        {/* Axe Nord-Sud */}
        <View
          style={{
            position: "absolute",
            left: center,
            top: 0,
            height: size,
            width: 1,
            backgroundColor: "#cbd5e1",
          }}
        />

        {/* Axe Est-Ouest */}
        <View
          style={{
            position: "absolute",
            top: center,
            left: 0,
            width: size,
            height: 1,
            backgroundColor: "#cbd5e1",
          }}
        />

        {/* Trajectoire : un segment par pas */}
        {trajectory.slice(1).map((point, index) => {
          const previous = project(trajectory[index]);
          const current = project(point);

          const dx = current.px - previous.px;
          const dy = current.py - previous.py;

          const length = Math.hypot(dx, dy);
          const angle = Math.atan2(dy, dx);

          return (
            <View
              key={index}
              style={{
                position: "absolute",
                left: (previous.px + current.px) / 2 - length / 2,
                top: (previous.py + current.py) / 2 - 1.5,
                width: length,
                height: 3,
                backgroundColor: "#2563eb",
                borderRadius: 2,
                transform: [{ rotate: `${angle}rad` }],
              }}
            />
          );
        })}

        {/* Départ (0,0) */}
        <View
          style={[
            styles.startDot,
            {
              left: start.px - 5,
              top: start.py - 5,
            },
          ]}
        />

        {/* Position actuelle */}
        {trajectory.length > 1 && (
          <View
            style={[
              styles.currentDot,
              {
                left: end.px - 6,
                top: end.py - 6,
              },
            ]}
          />
        )}

        <Text style={[styles.northLabel, { left: center + 6 }]}>N</Text>

        <Text style={[styles.eastLabel, { top: center + 5 }]}>E</Text>
      </View>

      <View style={styles.legend}>
        <Text style={styles.legendText}>🟢 Départ</Text>
        <Text style={styles.legendText}>🔴 Position actuelle</Text>
      </View>

      <Text style={styles.hint}>Fenêtre : ±{range.toFixed(1)} m</Text>

      <Text style={styles.hint}>
        L'échelle s'adapte automatiquement à la trajectoire.
      </Text>
    </View>
  );
}

export default function LocalizationTest() {
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("Initialisation...");
  const [heading, setHeading] = useState<number | null>(null);
  const [steps, setSteps] = useState(0);
  const [position, setPosition] = useState<Position>(ORIGIN);
  const [trajectory, setTrajectory] = useState<Position[]>([ORIGIN]);
  const [signal, setSignal] = useState(0);

  const runningRef = useRef(false);
  const headingRef = useRef<number | null>(null);
  const stepsRef = useRef(0);
  const positionRef = useRef<Position>(ORIGIN);
  const trajectoryRef = useRef<Position[]>([ORIGIN]);

  // Même détecteur de pas que V0.
  const samplesRef = useRef<number[]>([]);
  const armedRef = useRef(true);
  const lastStepTimeRef = useRef(0);
  const lastSignalDisplayRef = useRef(0);

  function resetDetector() {
    samplesRef.current = [];
    armedRef.current = true;
    lastStepTimeRef.current = 0;
  }

  function stop() {
    runningRef.current = false;
    setRunning(false);
  }

  function start() {
    if (headingRef.current === null) {
      setStatus("En attente du cap magnétique iOS...");
      return;
    }

    resetDetector();
    runningRef.current = true;
    setRunning(true);
    setStatus("Localisation active");
  }

  function reset() {
    stop();
    resetDetector();

    stepsRef.current = 0;
    positionRef.current = ORIGIN;
    trajectoryRef.current = [ORIGIN];

    setSteps(0);
    setPosition(ORIGIN);
    setTrajectory([ORIGIN]);
    setSignal(0);
    setStatus("Réinitialisé — prêt");
  }

  useEffect(() => {
    let mounted = true;

    let accelerometerSubscription:
      | ReturnType<typeof Accelerometer.addListener>
      | undefined;

    let headingSubscription: Location.LocationSubscription | undefined;

    async function initialize() {
      try {
        const available = await Accelerometer.isAvailableAsync();

        if (!mounted) return;

        if (!available) {
          setStatus("Accéléromètre indisponible");
          return;
        }

        const permission = await Location.requestForegroundPermissionsAsync();

        if (!mounted) return;

        if (!permission.granted) {
          setStatus("Permission du cap iOS refusée");
          return;
        }

        // Orientation magnétique fournie par iOS.
        // Aucune position GPS n'est utilisée.
        const subscription = await Location.watchHeadingAsync((data) => {
          if (!mounted) return;

          if (!Number.isFinite(data.magHeading) || data.magHeading < 0) {
            headingRef.current = null;
            setHeading(null);
            return;
          }

          const value = normalizeHeading(data.magHeading);

          headingRef.current = value;
          setHeading(value);
        });

        if (!mounted) {
          subscription.remove();
          return;
        }

        headingSubscription = subscription;

        Accelerometer.setUpdateInterval(INTERVAL_MS);

        accelerometerSubscription = Accelerometer.addListener(({ x, y, z }) => {
          if (!mounted || !runningRef.current) {
            return;
          }

          // 1. Norme de l'accélération
          const magnitude = Math.hypot(x, y, z);
          const centered = magnitude - 1;

          // 2. Moyenne glissante
          const samples = samplesRef.current;
          samples.push(centered);

          if (samples.length > MOVING_AVERAGE_SIZE) {
            samples.shift();
          }

          const filtered =
            samples.reduce((sum, value) => sum + value, 0) / samples.length;

          const now = Date.now();

          if (now - lastSignalDisplayRef.current >= 100) {
            lastSignalDisplayRef.current = now;
            setSignal(filtered);
          }

          // 3. Réarmement
          if (filtered <= REARM_THRESHOLD) {
            armedRef.current = true;
          }

          // 4. Détection d'un pas
          const validStep =
            armedRef.current &&
            filtered >= PEAK_THRESHOLD &&
            now - lastStepTimeRef.current >= MIN_STEP_INTERVAL_MS;

          if (!validStep) return;

          armedRef.current = false;
          lastStepTimeRef.current = now;

          stepsRef.current += 1;
          setSteps(stepsRef.current);

          // 5. Cap au moment de la détection
          const currentHeading = headingRef.current;

          if (currentHeading === null) return;

          const theta = (currentHeading * Math.PI) / 180;

          // 6. Mise à jour de la position
          const previous = positionRef.current;

          const next: Position = {
            x: previous.x + STEP_LENGTH_M * Math.sin(theta),
            y: previous.y + STEP_LENGTH_M * Math.cos(theta),
          };

          positionRef.current = next;
          setPosition(next);

          // 7. Ajouter un point à la trajectoire.
          const nextTrajectory = [...trajectoryRef.current, next];

          trajectoryRef.current = nextTrajectory;
          setTrajectory(nextTrajectory);
        });

        if (mounted) {
          setStatus("Prêt — appuyer sur Start");
        }
      } catch (error) {
        if (mounted) {
          setStatus("Erreur : " + String(error));
        }
      }
    }

    initialize();

    return () => {
      mounted = false;
      runningRef.current = false;
      accelerometerSubscription?.remove();
      headingSubscription?.remove();
    };
  }, []);

  const totalDistance = (trajectory.length - 1) * STEP_LENGTH_M;

  const displacement = distance(ORIGIN, position);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>V1.1 — Localisation 2D</Text>

      <Text style={styles.status}>{status}</Text>

      <View style={styles.controls}>
        <Pressable
          style={[
            styles.button,
            {
              backgroundColor: running ? "#dc2626" : "#16a34a",
            },
          ]}
          onPress={running ? stop : start}
        >
          <Text style={styles.buttonText}>{running ? "Stop" : "Start"}</Text>
        </Pressable>

        <Pressable
          style={[styles.button, { backgroundColor: "#64748b" }]}
          onPress={reset}
        >
          <Text style={styles.buttonText}>Reset</Text>
        </Pressable>
      </View>

      {/* Affichage principal */}
      <TrajectoryChart trajectory={trajectory} />

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Position actuelle</Text>

        <View style={styles.metrics}>
          <View style={styles.metric}>
            <Text style={styles.label}>X · Est</Text>
            <Text style={styles.value}>{position.x.toFixed(2)} m</Text>
          </View>

          <View style={styles.metric}>
            <Text style={styles.label}>Y · Nord</Text>
            <Text style={styles.value}>{position.y.toFixed(2)} m</Text>
          </View>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Mesures</Text>

        <Text style={styles.measure}>Pas détectés : {steps}</Text>

        <Text style={styles.measure}>
          Cap iOS : {heading === null ? "--" : heading.toFixed(1) + "°"}
        </Text>

        <Text style={styles.measure}>
          Longueur de pas : {STEP_LENGTH_M.toFixed(2)} m
        </Text>

        <Text style={styles.measure}>
          Distance parcourue estimée : {totalDistance.toFixed(2)} m
        </Text>

        <Text style={styles.measure}>
          Distance au départ : {displacement.toFixed(2)} m
        </Text>

        <Text style={styles.measure}>
          Signal filtré : {signal.toFixed(3)} g
        </Text>
      </View>

      <Text style={styles.hint}>
        Hypothèse V1 : le haut du téléphone est orienté dans le sens de la
        marche. La trajectoire est estimée, sans GPS.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    paddingBottom: 40,
    gap: 12,
    backgroundColor: "#f1f5f9",
  },
  title: {
    fontSize: 23,
    fontWeight: "bold",
    color: "#0f172a",
  },
  status: {
    fontSize: 14,
    color: "#64748b",
  },
  controls: {
    flexDirection: "row",
    gap: 12,
  },
  button: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: "bold",
  },
  chartCard: {
    backgroundColor: "#ffffff",
    padding: 12,
    borderRadius: 14,
    alignItems: "center",
    gap: 6,
  },
  plot: {
    position: "relative",
    backgroundColor: "#f8fafc",
    borderColor: "#e2e8f0",
    borderWidth: 1,
    overflow: "hidden",
  },
  northLabel: {
    position: "absolute",
    top: 5,
    fontSize: 12,
    color: "#64748b",
  },
  eastLabel: {
    position: "absolute",
    right: 5,
    fontSize: 12,
    color: "#64748b",
  },
  startDot: {
    position: "absolute",
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#16a34a",
  },
  currentDot: {
    position: "absolute",
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#dc2626",
  },
  legend: {
    flexDirection: "row",
    justifyContent: "space-around",
    width: "100%",
  },
  legendText: {
    fontSize: 12,
    color: "#334155",
  },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 14,
    padding: 16,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: "bold",
    color: "#0f172a",
  },
  hint: {
    fontSize: 12,
    color: "#64748b",
    lineHeight: 18,
  },
  metrics: {
    flexDirection: "row",
    gap: 12,
  },
  metric: {
    flex: 1,
    gap: 4,
  },
  label: {
    fontSize: 13,
    color: "#64748b",
  },
  value: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#2563eb",
  },
  measure: {
    fontSize: 15,
    color: "#334155",
  },
});
