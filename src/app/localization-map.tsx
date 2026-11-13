import * as Location from "expo-location";
import { useRouter } from "expo-router";
import { Accelerometer } from "expo-sensors";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import WebView from "react-native-webview";

// ======================================================
// V0 — Algorithme de détection des pas
// ======================================================

const INTERVAL_MS = 20;
const PEAK_THRESHOLD = 0.12;
const REARM_THRESHOLD = 0.02;
const MIN_STEP_INTERVAL_MS = 330;
const MOVING_AVERAGE_SIZE = 5;

// ======================================================
// V1.2 — Localisation
// ======================================================

const STEP_LENGTH_M = 0.7;

// Origine PG1 calibrée manuellement.
// Aucune coordonnée GPS du téléphone n'est utilisée.
const START_LAT = 49.40020289;
const START_LNG = 2.80016792;

const GOOGLE_MAPS_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY ?? "";

type Position = {
  x: number;
  y: number;
};

const ORIGIN: Position = { x: 0, y: 0 };

function normalizeHeading(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

function distanceFromOrigin(p: Position): number {
  return Math.hypot(p.x, p.y);
}

// ======================================================
// Google Maps + Canvas Overlay
// ======================================================

function makeMapHtml(apiKey: string): string {
  const key = encodeURIComponent(apiKey);

  return `
<!DOCTYPE html>
<html>
<head>
  <meta
    name="viewport"
    content="width=device-width, initial-scale=1,
    maximum-scale=1, user-scalable=no"
  />

  <style>
    html, body {
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 0;
      overflow: hidden;
    }

    #map-shell {
      position: relative;
      width: 100%;
      height: 100%;
      overflow: hidden;
    }

    #map {
      width: 100%;
      height: 100%;
    }

    /*
     * Le Canvas se trouve AU-DESSUS de Google Maps.
     * pointer-events: none permet de déplacer
     * et zoomer normalement la carte.
     */
    #trajectory-layer {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      z-index: 100;
      pointer-events: none;
    }

    #debug {
      position: absolute;
      top: 12px;
      right: 12px;
      z-index: 110;
      background: rgba(255,255,255,0.95);
      padding: 7px 10px;
      border-radius: 8px;
      color: #334155;
      font: 12px sans-serif;
      pointer-events: none;
    }
  </style>
</head>

<body>
  <div id="map-shell">
    <div id="map"></div>

    <canvas id="trajectory-layer"></canvas>

    <div id="debug">
      Initialisation...
    </div>
  </div>

  <script>
    // --------------------------------------------------
    // Configuration
    // --------------------------------------------------

    const origin = {
      lat: ${START_LAT},
      lng: ${START_LNG}
    };

    let map = null;
    let projectionOverlay = null;
    let projectionReady = false;
    let readySent = false;

    // Toutes les positions locales (x, y).
    // La première position est toujours l'origine.
    let positions = [
      { x: 0, y: 0 }
    ];

    const canvas =
      document.getElementById("trajectory-layer");

    const context =
      canvas.getContext("2d");

    let drawRequested = false;

    // --------------------------------------------------
    // Communication avec React Native
    // --------------------------------------------------

    function notify(type, message) {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(
          JSON.stringify({
            type: type,
            message: message || ""
          })
        );
      }
    }

    function updateDebug(text) {
      document.getElementById("debug").textContent =
        text;
    }

    // --------------------------------------------------
    // Conversion des coordonnées
    //
    // X : Est, en mètres
    // Y : Nord, en mètres
    // --------------------------------------------------

    function positionToLatLng(position) {
      return {
        lat:
          origin.lat +
          position.y / 111320,

        lng:
          origin.lng +
          position.x /
          (
            111320 *
            Math.cos(origin.lat * Math.PI / 180)
          )
      };
    }

    // --------------------------------------------------
    // Projection Google Maps
    //
    // Convertir une position locale en pixels
    // dans le conteneur de la carte.
    // --------------------------------------------------

    function positionToPixel(position) {
      if (!projectionOverlay || !projectionReady) {
        return null;
      }

      const projection =
        projectionOverlay.getProjection();

      if (!projection) return null;

      const coordinate =
        positionToLatLng(position);

      return projection.fromLatLngToContainerPixel(
        new google.maps.LatLng(
          coordinate.lat,
          coordinate.lng
        )
      );
    }

    // --------------------------------------------------
    // Adapter la résolution du Canvas
    // à celle de l'écran.
    // --------------------------------------------------

    function resizeCanvas() {
      const rect =
        document.getElementById("map-shell")
          .getBoundingClientRect();

      const ratio =
        window.devicePixelRatio || 1;

      const targetWidth =
        Math.round(rect.width * ratio);

      const targetHeight =
        Math.round(rect.height * ratio);

      if (
        canvas.width !== targetWidth ||
        canvas.height !== targetHeight
      ) {
        canvas.width = targetWidth;
        canvas.height = targetHeight;
      }

      context.setTransform(
        ratio, 0, 0, ratio, 0, 0
      );

      return {
        width: rect.width,
        height: rect.height
      };
    }

    // --------------------------------------------------
    // Dessiner un cercle en coordonnées écran.
    // --------------------------------------------------

    function drawDot(
      point,
      radius,
      fillColor,
      strokeColor
    ) {
      if (!point) return;

      context.beginPath();

      context.arc(
        point.x,
        point.y,
        radius,
        0,
        Math.PI * 2
      );

      context.fillStyle = fillColor;
      context.fill();

      context.lineWidth = 2;
      context.strokeStyle = strokeColor;
      context.stroke();
    }

    // --------------------------------------------------
    // Dessin complet de la trajectoire
    // --------------------------------------------------

    function drawTrajectory() {
      drawRequested = false;

      const size = resizeCanvas();

      context.clearRect(
        0,
        0,
        size.width,
        size.height
      );

      if (!projectionReady) {
        updateDebug("Projection en attente...");
        return;
      }

      const pixels = positions.map(
        positionToPixel
      );

      const validPixels = pixels.filter(
        function(p) {
          return p !== null;
        }
      );

      if (validPixels.length === 0) {
        updateDebug("Aucun point projeté");
        return;
      }

      // ----------------------------------------------
      // Tracé blanc : contour pour améliorer
      // la lisibilité sur la carte.
      // ----------------------------------------------

      function drawPath(color, lineWidth) {
        context.beginPath();

        let started = false;

        pixels.forEach(function(point) {
          if (!point) {
            started = false;
            return;
          }

          if (!started) {
            context.moveTo(
              point.x,
              point.y
            );

            started = true;
          } else {
            context.lineTo(
              point.x,
              point.y
            );
          }
        });

        context.strokeStyle = color;
        context.lineWidth = lineWidth;

        context.lineCap = "round";
        context.lineJoin = "round";

        context.stroke();
      }

      if (validPixels.length >= 2) {
        // Contour blanc
        drawPath("#ffffff", 9);

        // Trajectoire bleue
        drawPath("#2563eb", 5);
      }

      // ----------------------------------------------
      // Points individuels sur la trajectoire
      // ----------------------------------------------

      if (positions.length > 1) {
        pixels.slice(1, -1).forEach(
          function(point) {
            if (!point) return;

            context.beginPath();

            context.arc(
              point.x,
              point.y,
              2.5,
              0,
              Math.PI * 2
            );

            context.fillStyle = "#2563eb";
            context.fill();
          }
        );
      }

      // ----------------------------------------------
      // Départ vert
      // ----------------------------------------------

      const start = pixels[0];

      drawDot(
        start,
        6,
        "#22c55e",
        "#166534"
      );

      // ----------------------------------------------
      // Position actuelle rouge
      // ----------------------------------------------

      const current =
        pixels[pixels.length - 1];

      if (positions.length > 1) {
        drawDot(
          current,
          7,
          "#ef4444",
          "#991b1b"
        );
      }

      updateDebug(
        "Canvas : " +
        positions.length +
        " points"
      );
    }

    // --------------------------------------------------
    // Éviter plusieurs redessins simultanés.
    // --------------------------------------------------

    function scheduleDraw() {
      if (drawRequested) return;

      drawRequested = true;

      window.requestAnimationFrame(
        drawTrajectory
      );
    }

    // --------------------------------------------------
    // Initialisation Google Maps
    // --------------------------------------------------

    function initMap() {
      try {
        map = new google.maps.Map(
          document.getElementById("map"),
          {
            center: origin,
            zoom: 20,

            mapTypeId: "roadmap",
            heading: 0,
            tilt: 0,

            zoomControl: true,
            streetViewControl: false,
            mapTypeControl: false,
            fullscreenControl: false,
            rotateControl: false,

            gestureHandling: "greedy"
          }
        );

        // ----------------------------------------------
        // OverlayView est utilisé uniquement pour
        // obtenir la projection géographique.
        //
        // Le dessin réel est fait dans notre Canvas.
        // ----------------------------------------------

        projectionOverlay =
          new google.maps.OverlayView();

        projectionOverlay.onAdd = function() {
          // Aucun élément Google Maps à ajouter.
        };

        projectionOverlay.draw = function() {
          const projection =
            this.getProjection();

          if (!projection) return;

          projectionReady = true;

          scheduleDraw();

          if (!readySent) {
            readySent = true;
            notify("ready");
          }
        };

        projectionOverlay.onRemove = function() {
          projectionReady = false;
        };

        projectionOverlay.setMap(map);

        // ----------------------------------------------
        // Recalculer les pixels quand la carte
        // est déplacée ou zoomée.
        // ----------------------------------------------

        map.addListener(
          "bounds_changed",
          scheduleDraw
        );

        map.addListener(
          "idle",
          scheduleDraw
        );

        window.addEventListener(
          "resize",
          scheduleDraw
        );

        updateDebug("Carte initialisée");

      } catch (error) {
        notify("error", String(error));
      }
    }

    // --------------------------------------------------
    // Ajouter une position depuis React Native
    // --------------------------------------------------

    window.mi12AddPosition = function(position) {
      positions.push({
        x: position.x,
        y: position.y
      });

      scheduleDraw();

      // Suivi automatique de la position actuelle.
      if (map) {
        map.panTo(
          positionToLatLng(position)
        );
      }
    };

    // --------------------------------------------------
    // Restaurer la trajectoire / Reset
    // --------------------------------------------------

    window.mi12SetTrajectory = function(newPositions) {
      if (
        !Array.isArray(newPositions) ||
        newPositions.length === 0
      ) {
        positions = [
          { x: 0, y: 0 }
        ];
      } else {
        positions = newPositions.map(
          function(position) {
            return {
              x: position.x,
              y: position.y
            };
          }
        );
      }

      scheduleDraw();

      if (map) {
        map.panTo(
          positionToLatLng(
            positions[positions.length - 1]
          )
        );
      }
    };

    // --------------------------------------------------
    // Gestion des erreurs
    // --------------------------------------------------

    window.mi12MapError = function() {
      notify(
        "error",
        "Chargement Google Maps impossible"
      );
    };
  </script>

  <script
    async
    defer
    src="https://maps.googleapis.com/maps/api/js?key=${key}&callback=initMap"
    onerror="window.mi12MapError()">
  </script>
</body>
</html>
`;
}

const MAP_HTML = makeMapHtml(GOOGLE_MAPS_KEY);

// ======================================================
// Composant V1.2
// ======================================================

export default function LocalizationMap() {
  const router = useRouter();

  // WebView 14 : type explicite pour Expo SDK 58
  const webViewRef = useRef<WebView<{}> | null>(null);

  const mapReadyRef = useRef(false);

  const [mapReady, setMapReady] = useState(false);

  const [status, setStatus] = useState("Initialisation...");

  const [running, setRunning] = useState(false);

  const [heading, setHeading] = useState<number | null>(null);

  const [steps, setSteps] = useState(0);

  const [position, setPosition] = useState<Position>(ORIGIN);

  const [trajectoryCount, setTrajectoryCount] = useState(1);

  // ----------------------------------------------
  // Refs pour les données temps réel
  // ----------------------------------------------

  const runningRef = useRef(false);
  const headingRef = useRef<number | null>(null);

  const stepsRef = useRef(0);

  const positionRef = useRef<Position>(ORIGIN);

  const trajectoryRef = useRef<Position[]>([ORIGIN]);

  // ----------------------------------------------
  // Détecteur de pas
  // ----------------------------------------------

  const samplesRef = useRef<number[]>([]);

  const armedRef = useRef(true);

  const lastStepTimeRef = useRef(0);

  function resetDetector() {
    samplesRef.current = [];
    armedRef.current = true;
    lastStepTimeRef.current = 0;
  }

  // ----------------------------------------------
  // React Native -> Google Maps WebView
  // ----------------------------------------------

  function injectMapFunction(
    name: "mi12AddPosition" | "mi12SetTrajectory",
    payload: Position | Position[],
  ) {
    if (!mapReadyRef.current) return;

    const script =
      "window." + name + "(" + JSON.stringify(payload) + "); true;";

    webViewRef.current?.injectJavaScript(script);
  }

  // ==================================================
  // Contrôles
  // ==================================================

  function start() {
    if (headingRef.current === null) {
      setStatus("En attente du cap magnétique iOS...");
      return;
    }

    if (!mapReadyRef.current) {
      setStatus("En attente de Google Maps...");
      return;
    }

    resetDetector();

    runningRef.current = true;
    setRunning(true);

    setStatus("Localisation active");
  }

  function stop() {
    runningRef.current = false;
    setRunning(false);

    setStatus("Localisation arrêtée");
  }

  function reset() {
    runningRef.current = false;
    setRunning(false);

    resetDetector();

    stepsRef.current = 0;
    positionRef.current = ORIGIN;
    trajectoryRef.current = [ORIGIN];

    setSteps(0);
    setPosition(ORIGIN);
    setTrajectoryCount(1);

    setStatus("Réinitialisé — prêt");

    injectMapFunction("mi12SetTrajectory", [ORIGIN]);
  }

  // ==================================================
  // Capteurs
  // ==================================================

  useEffect(() => {
    let mounted = true;

    let accSubscription:
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

        // ------------------------------------------
        // Cap magnétique iOS
        // ------------------------------------------

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

        // ------------------------------------------
        // Accéléromètre
        // ------------------------------------------

        Accelerometer.setUpdateInterval(INTERVAL_MS);

        accSubscription = Accelerometer.addListener(({ x, y, z }) => {
          if (!mounted || !runningRef.current) {
            return;
          }

          // ==================================
          // 1. Norme
          // ==================================

          const magnitude = Math.hypot(x, y, z);

          const centered = magnitude - 1;

          // ==================================
          // 2. Moyenne glissante
          // ==================================

          const samples = samplesRef.current;

          samples.push(centered);

          if (samples.length > MOVING_AVERAGE_SIZE) {
            samples.shift();
          }

          const filtered =
            samples.reduce((sum, value) => sum + value, 0) / samples.length;

          const now = Date.now();

          // ==================================
          // 3. Réarmement
          // ==================================

          if (filtered <= REARM_THRESHOLD) {
            armedRef.current = true;
          }

          // ==================================
          // 4. Détection d'un pas
          // ==================================

          const validStep =
            armedRef.current &&
            filtered >= PEAK_THRESHOLD &&
            now - lastStepTimeRef.current >= MIN_STEP_INTERVAL_MS;

          if (!validStep) return;

          armedRef.current = false;

          lastStepTimeRef.current = now;

          stepsRef.current += 1;

          setSteps(stepsRef.current);

          // ==================================
          // 5. Cap au moment du pas
          // ==================================

          const currentHeading = headingRef.current;

          if (currentHeading === null) {
            return;
          }

          const theta = (currentHeading * Math.PI) / 180;

          // ==================================
          // 6. Dead Reckoning 2D
          // ==================================

          const previous = positionRef.current;

          const next: Position = {
            x: previous.x + STEP_LENGTH_M * Math.sin(theta),

            y: previous.y + STEP_LENGTH_M * Math.cos(theta),
          };

          positionRef.current = next;

          setPosition(next);

          // ==================================
          // 7. Trajectoire locale
          // ==================================

          trajectoryRef.current.push(next);

          setTrajectoryCount(trajectoryRef.current.length);

          // ==================================
          // 8. Google Maps + Canvas
          // ==================================

          injectMapFunction("mi12AddPosition", next);
        });

        if (mounted) {
          setStatus("Capteurs prêts");
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

      accSubscription?.remove();
      headingSubscription?.remove();
    };
  }, []);

  // ==================================================
  // Valeurs d'affichage
  // ==================================================

  const totalDistance = steps * STEP_LENGTH_M;

  const displacement = distanceFromOrigin(position);

  // ==================================================
  // Interface
  // ==================================================

  return (
    <SafeAreaView style={styles.screen}>
      {/* En-tête */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>‹ Retour</Text>
        </Pressable>

        <View style={styles.headerText}>
          <Text style={styles.title}>V1.2 · Carte PG1</Text>

          <Text style={styles.status}>{status}</Text>
        </View>
      </View>

      {/* Google Maps + Canvas */}
      <View style={styles.mapContainer}>
        {GOOGLE_MAPS_KEY ? (
          <WebView<{}>
            ref={webViewRef}
            source={{
              html: MAP_HTML,
              baseUrl: "https://localhost/",
            }}
            originWhitelist={["*"]}
            javaScriptEnabled
            domStorageEnabled
            style={styles.map}
            onMessage={(event) => {
              try {
                const message = JSON.parse(event.nativeEvent.data);

                if (message.type === "ready") {
                  mapReadyRef.current = true;
                  setMapReady(true);

                  // Restaurer la trajectoire
                  // si la carte est rechargée.
                  injectMapFunction("mi12SetTrajectory", trajectoryRef.current);
                }

                if (message.type === "error") {
                  mapReadyRef.current = false;
                  setMapReady(false);

                  setStatus("Erreur carte : " + message.message);
                }
              } catch {
                // Message inconnu.
              }
            }}
            onError={(event) => {
              mapReadyRef.current = false;
              setMapReady(false);

              setStatus("Erreur WebView : " + event.nativeEvent.description);
            }}
          />
        ) : (
          <View style={styles.mapFallback}>
            <Text style={styles.fallbackText}>
              Clé Google Maps absente. Vérifiez EXPO_PUBLIC_GOOGLE_MAPS_KEY.
            </Text>
          </View>
        )}

        <View pointerEvents="none" style={styles.mapBadge}>
          <Text style={styles.mapBadgeText}>
            {mapReady ? "● PG1 · Carte chargée" : "○ Chargement..."}
          </Text>
        </View>
      </View>

      {/* Mesures principales */}
      <View style={styles.metrics}>
        <View style={styles.metric}>
          <Text style={styles.metricLabel}>Pas</Text>

          <Text style={styles.metricValue}>{steps}</Text>
        </View>

        <View style={styles.metric}>
          <Text style={styles.metricLabel}>Cap iOS</Text>

          <Text style={styles.metricValue}>
            {heading === null ? "--" : heading.toFixed(0) + "°"}
          </Text>
        </View>

        <View style={styles.metric}>
          <Text style={styles.metricLabel}>Distance</Text>

          <Text style={styles.metricValue}>{totalDistance.toFixed(1)} m</Text>
        </View>
      </View>

      {/* Position */}
      <View style={styles.coordinates}>
        <Text style={styles.coordinateText}>
          X Est : {position.x.toFixed(2)} m
        </Text>

        <Text style={styles.coordinateText}>
          Y Nord : {position.y.toFixed(2)} m
        </Text>

        <Text style={styles.coordinateText}>
          Départ : {displacement.toFixed(2)} m
        </Text>
      </View>

      {/* Diagnostic */}
      <View style={styles.diagnostic}>
        <Text style={styles.diagnosticText}>
          Points tracés : {trajectoryCount}
        </Text>

        <Text style={styles.diagnosticText}>Affichage : Canvas Overlay</Text>
      </View>

      {/* Légende */}
      <View style={styles.legend}>
        <Text style={styles.legendText}>🟢 Départ</Text>

        <Text style={styles.legendText}>🔵 Trajectoire</Text>

        <Text style={styles.legendText}>🔴 Position</Text>
      </View>

      {/* Start / Stop / Reset */}
      <View style={styles.controls}>
        <Pressable
          onPress={running ? stop : start}
          style={[
            styles.button,
            {
              backgroundColor: running ? "#dc2626" : "#16a34a",
            },
          ]}
        >
          <Text style={styles.buttonText}>{running ? "Stop" : "Start"}</Text>
        </Pressable>

        <Pressable
          onPress={reset}
          style={[
            styles.button,
            {
              backgroundColor: "#64748b",
            },
          ]}
        >
          <Text style={styles.buttonText}>Reset</Text>
        </Pressable>
      </View>

      <Text style={styles.footer}>
        Origine fixe PG1 · Pas = 0,70 m · Sans GPS
      </Text>
    </SafeAreaView>
  );
}

// ======================================================
// Styles
// ======================================================

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#f1f5f9",
  },

  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 12,
  },

  backButton: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 9,
    backgroundColor: "#e2e8f0",
  },

  backText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#0f172a",
  },

  headerText: {
    flex: 1,
    gap: 3,
  },

  title: {
    fontSize: 19,
    fontWeight: "bold",
    color: "#0f172a",
  },

  status: {
    fontSize: 12,
    color: "#64748b",
  },

  mapContainer: {
    flex: 1,
    minHeight: 250,
    marginHorizontal: 12,
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: "#e2e8f0",
  },

  map: {
    flex: 1,
  },

  mapFallback: {
    flex: 1,
    justifyContent: "center",
    padding: 20,
  },

  fallbackText: {
    textAlign: "center",
    color: "#991b1b",
  },

  mapBadge: {
    position: "absolute",
    top: 10,
    left: 10,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: "rgba(255,255,255,0.92)",
  },

  mapBadgeText: {
    color: "#334155",
    fontSize: 12,
    fontWeight: "600",
  },

  metrics: {
    flexDirection: "row",
    marginHorizontal: 12,
    marginTop: 10,
    gap: 8,
  },

  metric: {
    flex: 1,
    padding: 10,
    borderRadius: 10,
    backgroundColor: "#ffffff",
    alignItems: "center",
    gap: 3,
  },

  metricLabel: {
    fontSize: 12,
    color: "#64748b",
  },

  metricValue: {
    fontSize: 19,
    fontWeight: "bold",
    color: "#2563eb",
  },

  coordinates: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginHorizontal: 15,
    marginTop: 10,
    gap: 4,
  },

  coordinateText: {
    fontSize: 11,
    color: "#334155",
  },

  diagnostic: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginHorizontal: 15,
    marginTop: 8,
  },

  diagnosticText: {
    fontSize: 11,
    color: "#64748b",
  },

  legend: {
    flexDirection: "row",
    justifyContent: "space-around",
    marginHorizontal: 12,
    marginTop: 8,
  },

  legendText: {
    fontSize: 12,
    color: "#475569",
  },

  controls: {
    flexDirection: "row",
    gap: 10,
    marginHorizontal: 12,
    marginTop: 12,
  },

  button: {
    flex: 1,
    paddingVertical: 15,
    borderRadius: 12,
    alignItems: "center",
  },

  buttonText: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: "bold",
  },

  footer: {
    fontSize: 11,
    color: "#64748b",
    textAlign: "center",
    marginTop: 8,
    marginBottom: 6,
  },
});
