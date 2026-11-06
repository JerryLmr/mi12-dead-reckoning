import * as Location from "expo-location";
import { Magnetometer } from "expo-sensors";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

const UPDATE_INTERVAL_MS = 100;

function normalizeAngle(angle: number) {
  return ((angle % 360) + 360) % 360;
}

function angleDifference(a: number, b: number) {
  return ((a - b + 540) % 360) - 180;
}

export default function CompassTest() {
  const [status, setStatus] = useState("Initialisation...");
  const [rawHeading, setRawHeading] = useState<number | null>(null);
  const [systemHeading, setSystemHeading] = useState<number | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);

  const [field, setField] = useState({
    x: 0,
    y: 0,
    z: 0,
  });

  useEffect(() => {
    let active = true;
    let magneticSubscription:
      | ReturnType<typeof Magnetometer.addListener>
      | undefined;

    let headingSubscription: Location.LocationSubscription | undefined;

    async function initialize() {
      try {
        const available = await Magnetometer.isAvailableAsync();

        if (!active) return;

        if (!available) {
          setStatus("Magnétomètre indisponible");
          return;
        }

        // Première estimation : formule simplifiée
        Magnetometer.setUpdateInterval(UPDATE_INTERVAL_MS);

        magneticSubscription = Magnetometer.addListener(({ x, y, z }) => {
          if (!active) return;

          const angle = normalizeAngle((Math.atan2(-x, y) * 180) / Math.PI);

          setField({ x, y, z });
          setRawHeading(angle);
        });

        // Autorisation demandée par expo-location sur iOS.
        // Aucune position GPS n'est lue par ce programme.
        const permission = await Location.requestForegroundPermissionsAsync();

        if (!active) return;

        if (!permission.granted) {
          setStatus("Permission refusée : seul le magnétomètre brut est actif");
          return;
        }

        headingSubscription = await Location.watchHeadingAsync(
          (result) => {
            if (!active) return;

            setSystemHeading(result.magHeading);
            setAccuracy(result.accuracy);
          },
          (error) => {
            if (active) {
              setStatus("Erreur du cap système : " + error);
            }
          },
        );

        if (!active) {
          headingSubscription.remove();
          return;
        }

        setStatus("Deux sources de cap actives");
      } catch (error) {
        if (active) {
          setStatus("Erreur : " + String(error));
        }
      }
    }

    initialize();

    return () => {
      active = false;
      magneticSubscription?.remove();
      headingSubscription?.remove();
    };
  }, []);

  const difference =
    rawHeading !== null && systemHeading !== null
      ? angleDifference(rawHeading, systemHeading)
      : null;

  const accuracyLabel =
    accuracy === 3
      ? "Haute"
      : accuracy === 2
        ? "Moyenne"
        : accuracy === 1
          ? "Faible"
          : accuracy === 0
            ? "Non calibrée"
            : "Inconnue";

  return (
    <View style={styles.container}>
      <Text style={styles.title}>MI12 · Comparaison des caps</Text>

      <Text style={styles.status}>{status}</Text>

      <View style={styles.card}>
        <Text style={styles.label}>Cap brut — Magnetometer + atan2</Text>
        <Text style={styles.value}>
          {rawHeading === null ? "--" : rawHeading.toFixed(1) + "°"}
        </Text>
        <Text style={styles.detail}>Sans compensation de l'inclinaison</Text>
      </View>

      <View style={[styles.card, styles.systemCard]}>
        <Text style={styles.label}>Cap système — iOS magHeading</Text>
        <Text style={styles.value}>
          {systemHeading === null ? "--" : systemHeading.toFixed(1) + "°"}
        </Text>
        <Text style={styles.detail}>
          Calibration : {accuracyLabel}
          {accuracy !== null ? ` (${accuracy}/3)` : ""}
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Différence angulaire</Text>
        <Text style={styles.smallValue}>
          {difference === null ? "--" : difference.toFixed(1) + "°"}
        </Text>
        <Text style={styles.detail}>
          Cap brut − Cap système, ramené entre −180° et 180°
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Champ magnétique (μT)</Text>
        <Text>X : {field.x.toFixed(2)}</Text>
        <Text>Y : {field.y.toFixed(2)}</Text>
        <Text>Z : {field.z.toFixed(2)}</Text>
        <Text>
          Norme :{" "}
          {Math.sqrt(field.x ** 2 + field.y ** 2 + field.z ** 2).toFixed(2)} μT
        </Text>
      </View>

      <Text style={styles.note}>
        Test : tenir le téléphone horizontal, écran vers le haut, puis le
        tourner lentement sur place.
      </Text>

      <Text style={styles.note}>
        Attention : la différence entre les deux angles ne mesure pas
        directement leur erreur par rapport au nord réel.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: "#fff",
    gap: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: "bold",
    marginBottom: 4,
  },
  status: {
    fontSize: 14,
    color: "#475569",
    marginBottom: 4,
  },
  card: {
    padding: 16,
    borderRadius: 12,
    backgroundColor: "#f1f5f9",
    gap: 6,
  },
  systemCard: {
    backgroundColor: "#dbeafe",
  },
  label: {
    fontSize: 15,
    fontWeight: "600",
  },
  value: {
    fontSize: 42,
    fontWeight: "bold",
    color: "#1d4ed8",
  },
  smallValue: {
    fontSize: 28,
    fontWeight: "bold",
  },
  detail: {
    fontSize: 12,
    color: "#64748b",
  },
  note: {
    fontSize: 13,
    color: "#475569",
    lineHeight: 19,
  },
});
