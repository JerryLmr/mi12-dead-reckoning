import { useRouter } from "expo-router";
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

type Sample = {
  time: number;
  x: number;
  y: number;
  z: number;
  norm: number;
};

const INTERVAL_MS = 20; // Fréquence demandée : 50 Hz
const MAX_POINTS = 150; // Environ 3 secondes à 50 Hz

export default function HomeScreen() {
  const { width } = useWindowDimensions();
  const chartWidth = Math.max(200, width - 64);
  const chartHeight = 200;

  const [current, setCurrent] = useState<Sample | null>(null);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [recording, setRecording] = useState(false);
  const [count, setCount] = useState(0);
  const [duration, setDuration] = useState(0);

  const recordingRef = useRef(false);
  const startTimeRef = useRef(0);
  const lastTimeRef = useRef(0);
  const samplesRef = useRef<Sample[]>([]);

  const router = useRouter();
  useEffect(() => {
    Accelerometer.setUpdateInterval(INTERVAL_MS);

    const subscription = Accelerometer.addListener(({ x, y, z }) => {
      const now = Date.now();

      const sample: Sample = {
        time: now,
        x,
        y,
        z,
        norm: Math.sqrt(x * x + y * y + z * z),
      };

      setCurrent(sample);

      if (recordingRef.current) {
        samplesRef.current.push(sample);

        // Keep only the latest points for the chart
        setSamples(samplesRef.current.slice(-MAX_POINTS));
        setCount(samplesRef.current.length);
        setDuration((now - startTimeRef.current) / 1000);
        lastTimeRef.current = now;
      }
    });

    return () => subscription.remove();
  }, []);

  const startRecording = () => {
    const now = Date.now();

    samplesRef.current = [];
    startTimeRef.current = now;
    lastTimeRef.current = now;

    setSamples([]);
    setCount(0);
    setDuration(0);

    recordingRef.current = true;
    setRecording(true);
  };

  const stopRecording = () => {
    recordingRef.current = false;
    setRecording(false);
  };

  const resetRecording = () => {
    recordingRef.current = false;
    setRecording(false);
    samplesRef.current = [];
    setSamples([]);
    setCount(0);
    setDuration(0);
  };

  // Chart range: 0g to 2g
  const minY = 0;
  const maxY = 2;

  const getY = (value: number) => {
    const normalized = Math.max(0, Math.min(1, (value - minY) / (maxY - minY)));

    return chartHeight * (1 - normalized);
  };

  const xStep = chartWidth / Math.max(1, MAX_POINTS - 1);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>MI12 - Dead Reckoning</Text>
      <Pressable
        onPress={() => {
          console.log("Map button pressed");
          router.push("/map-test");
        }}
        style={{
          backgroundColor: "#2563eb",
          padding: 14,
          borderRadius: 8,
          marginVertical: 12,
        }}
      >
        <Text style={{ color: "white", textAlign: "center" }}>
          打开 Google Maps 测试页面
        </Text>
      </Pressable>

      <Pressable
        onPress={() => router.push("/step-test")}
        style={{
          padding: 14,
          backgroundColor: "#16a34a",
          borderRadius: 8,
          marginVertical: 10,
        }}
      >
        <Text style={{ color: "white", textAlign: "center" }}>
          打开计步测试
        </Text>
      </Pressable>

      <Pressable
        onPress={() => router.push("/compass-test")}
        style={{
          backgroundColor: "#7c3aed",
          padding: 14,
          borderRadius: 8,
          marginVertical: 10,
        }}
      >
        <Text style={{ color: "white", textAlign: "center" }}>
          打开电子罗盘测试
        </Text>
      </Pressable>

      <Text style={styles.subtitle}>Test de l'accéléromètre</Text>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Mesures en temps réel</Text>

        <Text style={styles.measure}>
          X : {current?.x.toFixed(3) ?? "---"} g
        </Text>
        <Text style={styles.measure}>
          Y : {current?.y.toFixed(3) ?? "---"} g
        </Text>
        <Text style={styles.measure}>
          Z : {current?.z.toFixed(3) ?? "---"} g
        </Text>

        <Text style={styles.norm}>
          Norme : {current?.norm.toFixed(3) ?? "---"} g
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Accélération - Norme</Text>

        <Text style={styles.hint}>Fenêtre : environ 3 secondes</Text>

        <View
          style={[
            styles.chart,
            {
              width: chartWidth,
              height: chartHeight,
            },
          ]}
        >
          {[0, 0.5, 1, 1.5, 2].map((value) => (
            <View
              key={value}
              style={[
                styles.gridLine,
                {
                  top: getY(value),
                  width: chartWidth,
                },
              ]}
            />
          ))}

          {/* Reference line at 1g */}
          <View style={[styles.referenceLine, { top: getY(1) }]} />

          {samples.slice(1).map((sample, index) => {
            const previous = samples[index];

            const x1 = index * xStep;
            const x2 = (index + 1) * xStep;

            const y1 = getY(previous.norm);
            const y2 = getY(sample.norm);

            const dx = x2 - x1;
            const dy = y2 - y1;
            const length = Math.sqrt(dx * dx + dy * dy);
            const angle = Math.atan2(dy, dx);

            return (
              <View
                key={`${sample.time}-${index}`}
                style={{
                  position: "absolute",
                  left: (x1 + x2) / 2 - length / 2,
                  top: (y1 + y2) / 2 - 1,
                  width: length,
                  height: 2,
                  backgroundColor: "#2563eb",
                  transform: [{ rotate: `${angle}rad` }],
                }}
              />
            );
          })}
        </View>

        <View style={styles.axisLabels}>
          <Text style={styles.hint}>0 g</Text>
          <Text style={styles.hint}>1 g</Text>
          <Text style={styles.hint}>2 g</Text>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Enregistrement</Text>

        <Text style={styles.measure}>
          État : {recording ? "En cours" : "Arrêté"}
        </Text>

        <Text style={styles.measure}>Échantillons : {count}</Text>

        <Text style={styles.measure}>Durée : {duration.toFixed(1)} s</Text>

        <View style={styles.buttons}>
          <Pressable
            style={[
              styles.button,
              { backgroundColor: recording ? "#dc2626" : "#16a34a" },
            ]}
            onPress={recording ? stopRecording : startRecording}
          >
            <Text style={styles.buttonText}>
              {recording ? "Arrêter" : "Démarrer"}
            </Text>
          </Pressable>

          <Pressable
            style={[styles.button, { backgroundColor: "#64748b" }]}
            onPress={resetRecording}
          >
            <Text style={styles.buttonText}>Réinitialiser</Text>
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: 16,
    paddingTop: 55,
    backgroundColor: "#f1f5f9",
  },
  title: {
    fontSize: 25,
    fontWeight: "bold",
    textAlign: "center",
    color: "#0f172a",
  },
  subtitle: {
    fontSize: 16,
    textAlign: "center",
    marginBottom: 20,
    color: "#64748b",
  },
  card: {
    backgroundColor: "#ffffff",
    padding: 16,
    borderRadius: 14,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 12,
    color: "#0f172a",
  },
  measure: {
    fontSize: 17,
    marginVertical: 3,
    color: "#334155",
  },
  norm: {
    fontSize: 22,
    fontWeight: "bold",
    marginTop: 12,
    color: "#2563eb",
  },
  hint: {
    fontSize: 12,
    color: "#64748b",
    marginBottom: 8,
  },
  chart: {
    backgroundColor: "#f8fafc",
    overflow: "hidden",
    position: "relative",
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  gridLine: {
    position: "absolute",
    height: 1,
    backgroundColor: "#e2e8f0",
  },
  referenceLine: {
    position: "absolute",
    width: "100%",
    height: 1,
    backgroundColor: "#f59e0b",
  },
  axisLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
  },
  buttons: {
    flexDirection: "row",
    gap: 10,
    marginTop: 16,
  },
  button: {
    flex: 1,
    paddingVertical: 13,
    alignItems: "center",
    borderRadius: 10,
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "bold",
  },
});
