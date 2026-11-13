
import * as Location from "expo-location";
import { Accelerometer, Magnetometer } from "expo-sensors";
import { useEffect, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

type Vector3 = {
  x: number;
  y: number;
  z: number;
};

type Measurements = {
  magnetic: Vector3 | null;
  gravity: Vector3 | null;
  systemHeading: number | null;
  accuracy: number | null;
};

const ACC_INTERVAL_MS = 20;
const MAG_INTERVAL_MS = 100;
const GRAVITY_ALPHA = 0.08;

function magnitude(v: Vector3): number {
  return Math.hypot(v.x, v.y, v.z);
}

function multiply(v: Vector3, k: number): Vector3 {
  return {
    x: v.x * k,
    y: v.y * k,
    z: v.z * k,
  };
}

function subtract(a: Vector3, b: Vector3): Vector3 {
  return {
    x: a.x - b.x,
    y: a.y - b.y,
    z: a.z - b.z,
  };
}

function dot(a: Vector3, b: Vector3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Vector3, b: Vector3): Vector3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function normalize(v: Vector3): Vector3 | null {
  const length = magnitude(v);

  if (length < 1e-6) return null;

  return multiply(v, 1 / length);
}

function normalizeAngle(angle: number): number {
  return ((angle % 360) + 360) % 360;
}

function angleDifference(a: number, b: number): number {
  return ((a - b + 540) % 360) - 180;
}

function calculateCompensatedHeading(
  magnetic: Vector3,
  gravity: Vector3,
  invertVertical: boolean
): number | null {
  const gravityUnit = normalize(gravity);

  if (!gravityUnit) return null;

  // Tester les deux conventions possibles
  // pour l'axe vertical du repère du téléphone.
  const up = multiply(
    gravityUnit,
    invertVertical ? -1 : 1
  );

  // Projection du champ magnétique
  // sur le plan horizontal.
  const horizontalMagnetic = subtract(
    magnetic,
    multiply(up, dot(magnetic, up))
  );

  const north = normalize(horizontalMagnetic);

  if (!north) return null;

  // Convention géométrique : Est = Nord x Haut.
  const east = normalize(cross(north, up));

  if (!east) return null;

  // Axe Y du téléphone : bord supérieur de l'écran.
  const phoneForward: Vector3 = {
    x: 0,
    y: 1,
    z: 0,
  };

  // Projection de l'axe avant sur l'horizontale.
  const horizontalForward = subtract(
    phoneForward,
    multiply(up, dot(phoneForward, up))
  );

  if (magnitude(horizontalForward) < 0.15) {
    return null;
  }

  const forward = normalize(horizontalForward);

  if (!forward) return null;

  const northComponent = dot(forward, north);
  const eastComponent = dot(forward, east);

  return normalizeAngle(
    (Math.atan2(eastComponent, northComponent) *
      180) /
      Math.PI
  );
}

function displayAngle(value: number | null): string {
  return value === null ? "--" : value.toFixed(1) + "°";
}

function accuracyLabel(accuracy: number | null): string {
  switch (accuracy) {
    case 3:
      return "Haute";
    case 2:
      return "Moyenne";
    case 1:
      return "Faible";
    case 0:
      return "Non calibrée";
    default:
      return "Inconnue";
  }
}

export default function CompassTest() {
  const [status, setStatus] = useState("Initialisation...");

  const [invertVertical, setInvertVertical] =
    useState(true);

  const [measurements, setMeasurements] =
    useState<Measurements>({
      magnetic: null,
      gravity: null,
      systemHeading: null,
      accuracy: null,
    });

  const gravityRef = useRef<Vector3 | null>(null);
  const magneticRef = useRef<Vector3 | null>(null);
  const systemHeadingRef = useRef<number | null>(null);
  const accuracyRef = useRef<number | null>(null);
  const lastUpdateRef = useRef(0);

  useEffect(() => {
    let active = true;

    let accSubscription:
      | ReturnType<typeof Accelerometer.addListener>
      | undefined;

    let magSubscription:
      | ReturnType<typeof Magnetometer.addListener>
      | undefined;

    let headingSubscription:
      | Location.LocationSubscription
      | undefined;

    function publishMeasurements() {
      const now = Date.now();

      if (now - lastUpdateRef.current < 100) {
        return;
      }

      lastUpdateRef.current = now;

      if (!active) return;

      setMeasurements({
        magnetic: magneticRef.current,
        gravity: gravityRef.current,
        systemHeading: systemHeadingRef.current,
        accuracy: accuracyRef.current,
      });
    }

    async function initialize() {
      try {
        const [accAvailable, magAvailable] =
          await Promise.all([
            Accelerometer.isAvailableAsync(),
            Magnetometer.isAvailableAsync(),
          ]);

        if (!active) return;

        if (!accAvailable || !magAvailable) {
          setStatus("Capteurs indisponibles");
          return;
        }

        const sensorPermission =
          await Magnetometer.requestPermissionsAsync();

        if (!active) return;

        if (!sensorPermission.granted) {
          setStatus("Autorisation des capteurs refusée");
          return;
        }

        Accelerometer.setUpdateInterval(ACC_INTERVAL_MS);
        Magnetometer.setUpdateInterval(MAG_INTERVAL_MS);

        accSubscription = Accelerometer.addListener(
          ({ x, y, z }) => {
            if (!active) return;

            const sample = { x, y, z };

            if (!gravityRef.current) {
              gravityRef.current = sample;
            } else {
              const previous = gravityRef.current;

              gravityRef.current = {
                x:
                  (1 - GRAVITY_ALPHA) * previous.x +
                  GRAVITY_ALPHA * x,
                y:
                  (1 - GRAVITY_ALPHA) * previous.y +
                  GRAVITY_ALPHA * y,
                z:
                  (1 - GRAVITY_ALPHA) * previous.z +
                  GRAVITY_ALPHA * z,
              };
            }

            publishMeasurements();
          }
        );

        magSubscription = Magnetometer.addListener(
          ({ x, y, z }) => {
            if (!active) return;

            magneticRef.current = { x, y, z };
            publishMeasurements();
          }
        );

        const locationPermission =
          await Location.requestForegroundPermissionsAsync();

        if (!active) return;

        if (!locationPermission.granted) {
          setStatus(
            "Cap compensé actif, mais cap iOS non autorisé"
          );
          return;
        }

        const subscription =
          await Location.watchHeadingAsync(
            (heading) => {
              if (!active) return;

              systemHeadingRef.current =
                heading.magHeading;

              accuracyRef.current = heading.accuracy;

              publishMeasurements();
            },
            (error) => {
              if (active) {
                setStatus("Erreur cap iOS : " + error);
              }
            }
          );

        if (!active) {
          subscription.remove();
          return;
        }

        headingSubscription = subscription;
        setStatus("Comparaison active");
      } catch (error) {
        if (active) {
          setStatus("Erreur : " + String(error));
        }
      }
    }

    initialize();

    return () => {
      active = false;
      accSubscription?.remove();
      magSubscription?.remove();
      headingSubscription?.remove();
    };
  }, []);

  const compensatedHeading =
    measurements.magnetic && measurements.gravity
      ? calculateCompensatedHeading(
          measurements.magnetic,
          measurements.gravity,
          invertVertical
        )
      : null;

  const systemHeading = measurements.systemHeading;

  const difference =
    compensatedHeading !== null && systemHeading !== null
      ? angleDifference(compensatedHeading, systemHeading)
      : null;

  const verticalAxis =
    measurements.gravity?.z ?? null;

  return (
    <ScrollView
      contentContainerStyle={styles.container}
    >
      <Text style={styles.title}>
        MI12 · Estimation du cap
      </Text>

      <Text style={styles.subtitle}>
        V0 — Compensation de l'inclinaison
      </Text>

      <Text style={styles.status}>{status}</Text>

      <View style={styles.compensatedCard}>
        <Text style={styles.label}>
          Cap compensé — Méthode du cours
        </Text>

        <Text style={styles.heading}>
          {displayAngle(compensatedHeading)}
        </Text>

        <Text style={styles.detail}>
          Accéléromètre + magnétomètre
        </Text>
      </View>

      <View style={styles.systemCard}>
        <Text style={styles.label}>
          Cap iOS — magHeading
        </Text>

        <Text style={styles.heading}>
          {displayAngle(systemHeading)}
        </Text>

        <Text style={styles.detail}>
          Calibration :{" "}
          {accuracyLabel(measurements.accuracy)}
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>
          Écart angulaire
        </Text>

        <Text style={styles.difference}>
          {displayAngle(difference)}
        </Text>

        <Text style={styles.detail}>
          Cap compensé − Cap iOS
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>
          Vérification du repère
        </Text>

        <Text style={styles.detail}>
          Axe vertical :{" "}
          {invertVertical ? "Inversé" : "Normal"}
        </Text>

        <Text style={styles.detail}>
          Accélération Z filtrée :{" "}
          {verticalAxis === null
            ? "--"
            : verticalAxis.toFixed(3) + " g"}
        </Text>

        <Pressable
          style={styles.button}
          onPress={() => {
            setInvertVertical((current) => !current);
          }}
        >
          <Text style={styles.buttonText}>
            Inverser l'axe vertical
          </Text>
        </Pressable>

        <Text style={styles.detail}>
          Ce réglage sert uniquement à vérifier
          le signe de l'axe vertical.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>
          Champ magnétique
        </Text>

        <Text style={styles.detail}>
          Norme :{" "}
          {measurements.magnetic
            ? magnitude(measurements.magnetic).toFixed(2) +
              " μT"
            : "--"}
        </Text>
      </View>

      <Text style={styles.note}>
        Garder le téléphone horizontal, écran vers
        le haut. Tourner ensuite de 90° en
        conservant la même inclinaison.
      </Text>

      <Text style={styles.note}>
        Comparer les deux conventions verticales
        à la même position, sans déplacer
        le téléphone.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 18,
    paddingBottom: 40,
    backgroundColor: "#ffffff",
    gap: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: "bold",
  },
  subtitle: {
    fontSize: 14,
    color: "#64748b",
  },
  status: {
    fontSize: 13,
    color: "#475569",
  },
  card: {
    backgroundColor: "#f1f5f9",
    padding: 16,
    borderRadius: 12,
    gap: 8,
  },
  compensatedCard: {
    backgroundColor: "#dcfce7",
    padding: 16,
    borderRadius: 12,
    gap: 8,
  },
  systemCard: {
    backgroundColor: "#dbeafe",
    padding: 16,
    borderRadius: 12,
    gap: 8,
  },
  label: {
    fontSize: 15,
    fontWeight: "600",
    color: "#0f172a",
  },
  heading: {
    fontSize: 38,
    fontWeight: "bold",
    color: "#1d4ed8",
  },
  difference: {
    fontSize: 30,
    fontWeight: "bold",
    color: "#334155",
  },
  detail: {
    fontSize: 13,
    color: "#475569",
    lineHeight: 19,
  },
  button: {
    backgroundColor: "#475569",
    borderRadius: 9,
    paddingVertical: 13,
    alignItems: "center",
    marginTop: 4,
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "600",
  },
  note: {
    fontSize: 13,
    color: "#64748b",
    lineHeight: 19,
  },
});
