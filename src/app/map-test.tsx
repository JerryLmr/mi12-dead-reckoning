import { useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";

export default function MapTest() {
  const webViewRef = useRef<WebView>(null);

  const [status, setStatus] = useState("正在加载 Google Maps...");
  const [ready, setReady] = useState(false);
  const [departure, setDeparture] = useState("");

  const apiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY ?? "";

  const html = useMemo(
    () => `
<!DOCTYPE html>
<html lang="zh">
<head>
  <meta name="viewport"
        content="width=device-width, initial-scale=1,
                 maximum-scale=1, user-scalable=yes" />
  <style>
    html, body, #map {
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 0;
    }
  </style>
</head>
<body>
  <div id="map"></div>

  <script>
    function report(type, payload) {
      window.ReactNativeWebView.postMessage(
        JSON.stringify({ type, payload })
      );
    }

    function initMap() {
      try {
        window.mi12Map = new google.maps.Map(
          document.getElementById("map"),
          {
            center: { lat: 49.417, lng: 2.825 },
            zoom: 19,
            mapTypeId: "roadmap",
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false,
            clickableIcons: false,
            gestureHandling: "greedy"
          }
        );

        report("ready", "Google Maps 已加载，请移动地图");
      } catch (error) {
        report("error", String(error));
      }
    }

    window.confirmDeparture = function() {
      if (!window.mi12Map) {
        report("error", "地图尚未加载");
        return;
      }

      const center = window.mi12Map.getCenter();

      if (!center) {
        report("error", "无法读取地图中心");
        return;
      }

      const position = {
        lat: center.lat(),
        lng: center.lng()
      };

      report("departure", position);
    };

    window.gm_authFailure = function() {
      report("error", "Google Maps API Key 验证失败");
    };
  </script>

  <script
    src="https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&callback=initMap&v=weekly"
    async
    defer
    onerror="report('error', 'Google Maps 脚本加载失败')"
  ></script>
</body>
</html>
`,
    [apiKey],
  );

  const confirmDeparture = () => {
    webViewRef.current?.injectJavaScript(`
      window.confirmDeparture();
      true;
    `);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>MI12 · Calibration du départ</Text>

      <Text style={styles.status} selectable>
        {departure || status}
      </Text>

      <View style={styles.mapContainer}>
        <WebView
          ref={webViewRef}
          style={styles.map}
          originWhitelist={["*"]}
          source={{ html }}
          javaScriptEnabled
          domStorageEnabled
          onMessage={(event) => {
            try {
              const message = JSON.parse(event.nativeEvent.data);

              if (message.type === "ready") {
                setReady(true);
                setStatus(message.payload);
              } else if (message.type === "departure") {
                const { lat, lng } = message.payload;

                setDeparture(
                  "Départ : " + lat.toFixed(8) + ", " + lng.toFixed(8),
                );
              } else if (message.type === "error") {
                setStatus(message.payload);
              }
            } catch {
              setStatus("消息解析失败");
            }
          }}
        />

        {/* 固定在地图视觉中心的准星 */}
        <View pointerEvents="none" style={styles.crosshair}>
          <View style={styles.crosshairHorizontal} />
          <View style={styles.crosshairVertical} />
        </View>
      </View>

      <Pressable
        onPress={confirmDeparture}
        disabled={!ready}
        style={[styles.button, !ready && styles.buttonDisabled]}
      >
        <Text style={styles.buttonText}>Confirmer le départ (0, 0)</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#ffffff",
    paddingTop: 16,
  },
  title: {
    fontSize: 19,
    fontWeight: "bold",
    marginHorizontal: 16,
    marginBottom: 8,
  },
  status: {
    fontSize: 14,
    marginHorizontal: 16,
    marginBottom: 10,
  },
  mapContainer: {
    flex: 1,
    position: "relative",
  },
  map: {
    flex: 1,
  },
  crosshair: {
    position: "absolute",
    top: "50%",
    left: "50%",
    width: 26,
    height: 26,
    marginLeft: -13,
    marginTop: -13,
    alignItems: "center",
    justifyContent: "center",
  },
  crosshairHorizontal: {
    position: "absolute",
    width: 26,
    height: 2,
    backgroundColor: "#ef4444",
  },
  crosshairVertical: {
    position: "absolute",
    width: 2,
    height: 26,
    backgroundColor: "#ef4444",
  },
  button: {
    backgroundColor: "#2563eb",
    paddingVertical: 15,
    alignItems: "center",
    marginHorizontal: 16,
    marginVertical: 12,
    borderRadius: 10,
  },
  buttonDisabled: {
    backgroundColor: "#94a3b8",
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
});
