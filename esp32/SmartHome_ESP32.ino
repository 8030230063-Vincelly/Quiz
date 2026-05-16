#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "DHT.h"

// --- KONFIGURASI WIFI ---
const char* ssid = "NAMA_WIFI_ANDA";
const char* password = "PASSWORD_WIFI_ANDA";

// --- KONFIGURASI BACKEND ---
// Ganti dengan URL Vercel Anda (Sesuai Dashboard Vercel)
const char* serverUrl = "https://quiz-umber-rho.vercel.app";

// --- KONFIGURASI PIN ---
#define DHTPIN 4
#define DHTTYPE DHT11
#define RELAY1_PIN 12
#define RELAY2_PIN 13
#define RELAY3_PIN 14
#define RELAY4_PIN 27

DHT dht(DHTPIN, DHTTYPE);

void setup() {
  Serial.begin(115200);
  
  pinMode(RELAY1_PIN, OUTPUT);
  pinMode(RELAY2_PIN, OUTPUT);
  pinMode(RELAY3_PIN, OUTPUT);
  pinMode(RELAY4_PIN, OUTPUT);

  // Matikan semua relay di awal (Active Low/High menyesuaikan module)
  digitalWrite(RELAY1_PIN, HIGH); 
  digitalWrite(RELAY2_PIN, HIGH);
  digitalWrite(RELAY3_PIN, HIGH);
  digitalWrite(RELAY4_PIN, HIGH);

  dht.begin();
  initWiFi();
}

void initWiFi() {
  WiFi.begin(ssid, password);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nConnected to WiFi");
}

unsigned long lastUpdate = 0;
const int updateInterval = 10000; // Kirim data sensor setiap 10 detik

void loop() {
  if (WiFi.status() == WL_CONNECTED) {
    checkRelayStatus();
    
    // Kirim data sensor setiap 10 detik
    if (millis() - lastUpdate > updateInterval) {
      sendSensorData();
      lastUpdate = millis();
    }
  } else {
    initWiFi();
  }
}

void checkRelayStatus() {
  HTTPClient http;
  String url = String(serverUrl) + "/api/relays";
  
  http.begin(url);
  int httpCode = http.GET();

  if (httpCode == 200) {
    String payload = http.getString();
    DynamicJsonDocument doc(256);
    deserializeJson(doc, payload);

    // Update Relay (Inverse Logic: false = HIGH/OFF, true = LOW/ON)
    digitalWrite(RELAY1_PIN, doc["1"] ? LOW : HIGH);
    digitalWrite(RELAY2_PIN, doc["2"] ? LOW : HIGH);
    digitalWrite(RELAY3_PIN, doc["3"] ? LOW : HIGH);
    digitalWrite(RELAY4_PIN, doc["4"] ? LOW : HIGH);
  }
  http.end();
}

void sendSensorData() {
  float h = dht.readHumidity();
  float t = dht.readTemperature();

  if (isnan(h) || isnan(t)) {
    Serial.println("Failed to read from DHT sensor!");
    return;
  }

  HTTPClient http;
  String url = String(serverUrl) + "/api/update-sensor";
  
  http.begin(url);
  http.addHeader("Content-Type", "application/json");

  String jsonPayload = "{\"temp\":" + String(t) + ",\"humidity\":" + String(h) + "}";
  
  int httpCode = http.POST(jsonPayload);
  if (httpCode > 0) {
    Serial.printf("Sensor Data Sent. Code: %d\n", httpCode);
  } else {
    Serial.printf("Sensor Data Failed. Error: %s\n", http.errorToString(httpCode).c_str());
  }
  http.end();
}
