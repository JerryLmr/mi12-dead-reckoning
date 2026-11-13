import { Stack } from "expo-router";

export default function RootLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: "MI12 - Dead Reckoning" }} />
      <Stack.Screen name="map-test" options={{ title: "Google Maps Test" }} />
      <Stack.Screen
        name="step-test"
        options={{ title: "Step Detection Test" }}
      />
      <Stack.Screen name="compass-test" options={{ title: "Compass Test" }} />
      <Stack.Screen
        name="localization-test"
        options={{ title: "Localisation 2D" }}
      />
      <Stack.Screen name="localization-map" options={{ headerShown: false }} />
    </Stack>
  );
}
