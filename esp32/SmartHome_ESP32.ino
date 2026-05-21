#include <WiFi.h>
#include <WebServer.h>
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
#define DHTTYPE DHT11 // GANTI ke DHT22 jika sensor Anda berwarna Putih

#define RELAY1_PIN 12
#define RELAY2_PIN 13
#define RELAY3_PIN 14
#define RELAY4_PIN 27

DHT dht(DHTPIN, DHTTYPE);

WebServer server(80);

// Prototipe Fungsi WebServer untuk compiler C++
void handleStatus();
void handleRelayControl();
void handleSpeedControl();

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

  // Registrasi Endpoint WebServer Lokal
  server.on("/api/status", handleStatus);
  server.on("/api/relay", handleRelayControl);
  server.on("/api/speed", handleSpeedControl);
  server.begin();
  Serial.println("Local HTTP WebServer started on port 80!");
}

void initWiFi() {
  WiFi.begin(ssid, password);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nConnected to WiFi");
  Serial.print("IP Address ESP32: ");
  Serial.println(WiFi.localIP()); // Cetak IP agar user gampang salin ke web dashboard
}

unsigned long lastUpdate = 0;
const int updateInterval = 10000; // Kirim data sensor setiap 10 detik

unsigned long lastRelayCheck = 0;
const int relayCheckInterval = 1000; // Cek status relay setiap 1 detik

int currentSequence = 0;
unsigned long lastSeqStep = 0;
int seqStep = 0;
int sequenceDelay = 200; // default interval 200ms (lebih cepat dibanding sebelumnya yang 500ms)

// Handler untuk memberikan status pembacaan sensor dan relay langsung via LAN (CORS-enabled)
void handleStatus() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "*");
  
  if (server.method() == HTTP_OPTIONS) {
    server.send(204);
    return;
  }

  float h = dht.readHumidity();
  float t = dht.readTemperature();
  if (isnan(h) || isnan(t)) { h = 0; t = 0; }

  DynamicJsonDocument doc(512);
  doc["temp"] = t;
  doc["humidity"] = h;
  doc["sequence"] = currentSequence;
  doc["sequenceDelay"] = sequenceDelay;
  
  JsonObject rs = doc.createNestedObject("relays");
  // Karena relay active-low, LOW berarti relay menyala (ON = true)
  rs["1"] = (digitalRead(RELAY1_PIN) == LOW);
  rs["2"] = (digitalRead(RELAY2_PIN) == LOW);
  rs["3"] = (digitalRead(RELAY3_PIN) == LOW);
  rs["4"] = (digitalRead(RELAY4_PIN) == LOW);

  String response;
  serializeJson(doc, response);
  server.send(200, "application/json", response);
}

// Handler untuk kontrol relay instan dari web dashboard lokal (CORS-enabled)
void handleRelayControl() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "*");

  if (server.method() == HTTP_OPTIONS) {
    server.send(204);
    return;
  }

  if (server.hasArg("id") && server.hasArg("state")) {
    int id = server.arg("id").toInt();
    String state = server.arg("state");
    bool pinValue = (state == "on" || state == "1") ? LOW : HIGH; // Active Low (LOW = ON)

    if (id == 1) digitalWrite(RELAY1_PIN, pinValue);
    else if (id == 2) digitalWrite(RELAY2_PIN, pinValue);
    else if (id == 3) digitalWrite(RELAY3_PIN, pinValue);
    else if (id == 4) digitalWrite(RELAY4_PIN, pinValue);

    server.send(200, "application/json", "{\"status\":\"ok\",\"message\":\"Relay updated directly via LAN\"}");
  } else {
    server.send(400, "application/json", "{\"error\":\"Missing arguments id or state\"}");
  }
}

// Handler untuk kontrol kecepatan variasi instan dari web dashboard lokal (CORS-enabled)
void handleSpeedControl() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "*");

  if (server.method() == HTTP_OPTIONS) {
    server.send(204);
    return;
  }

  if (server.hasArg("delay")) {
    int delayVal = server.arg("delay").toInt();
    if (delayVal >= 50 && delayVal <= 2000) {
      sequenceDelay = delayVal;
      server.send(200, "application/json", "{\"status\":\"ok\",\"sequenceDelay\":" + String(sequenceDelay) + "}");
    } else {
      server.send(400, "application/json", "{\"error\":\"Delay bounds are 50ms - 2000ms\"}");
    }
  } else {
    server.send(400, "application/json", "{\"error\":\"Missing delay query param\"}");
  }
}

void loop() {
  server.handleClient(); // Tangani request dari browser secara instan
  if (WiFi.status() == WL_CONNECTED) {
    // Cek status relay setiap 1 detik untuk kestabilan
    if (millis() - lastRelayCheck > relayCheckInterval) {
      checkRelayStatus();
      lastRelayCheck = millis();
    }
    
    // Handle Sequence Logic
    if (currentSequence == 1) { // 1-2-3-4
      if (millis() - lastSeqStep > sequenceDelay) {
        allRelaysOff();
        if (seqStep == 0) digitalWrite(RELAY1_PIN, LOW);
        else if (seqStep == 1) digitalWrite(RELAY2_PIN, LOW);
        else if (seqStep == 2) digitalWrite(RELAY3_PIN, LOW);
        else if (seqStep == 3) digitalWrite(RELAY4_PIN, LOW);
        seqStep = (seqStep + 1) % 4;
        lastSeqStep = millis();
      }
    } else if (currentSequence == 2) { // 4-3-2-1
      if (millis() - lastSeqStep > sequenceDelay) {
        allRelaysOff();
        if (seqStep == 0) digitalWrite(RELAY4_PIN, LOW);
        else if (seqStep == 1) digitalWrite(RELAY3_PIN, LOW);
        else if (seqStep == 2) digitalWrite(RELAY2_PIN, LOW);
        else if (seqStep == 3) digitalWrite(RELAY1_PIN, LOW);
        seqStep = (seqStep + 1) % 4;
        lastSeqStep = millis();
      }
    }

    // Kirim data sensor setiap 10 detik
    if (millis() - lastUpdate > updateInterval) {
      sendSensorData();
      lastUpdate = millis();
    }
  } else {
    initWiFi();
  }
}

void allRelaysOff() {
  digitalWrite(RELAY1_PIN, HIGH);
  digitalWrite(RELAY2_PIN, HIGH);
  digitalWrite(RELAY3_PIN, HIGH);
  digitalWrite(RELAY4_PIN, HIGH);
}

void checkRelayStatus() {
  HTTPClient http;
  String url = String(serverUrl) + "/api/relays";
  
  http.begin(url);
  int httpCode = http.GET();

  if (httpCode == 200) {
    String payload = http.getString();
    DynamicJsonDocument doc(512);
    deserializeJson(doc, payload);

    int newSeq = doc["sequence"] | 0;
    
    if (doc.containsKey("sequenceDelay")) {
      sequenceDelay = doc["sequenceDelay"] | 200;
    }
    
    if (newSeq != currentSequence) {
      currentSequence = newSeq;
      seqStep = 0;
      if (currentSequence == 0) {
        // Reset to normal relay state if sequence stopped
        JsonObject rs = doc["relays"];
        digitalWrite(RELAY1_PIN, rs["1"] ? LOW : HIGH);
        digitalWrite(RELAY2_PIN, rs["2"] ? LOW : HIGH);
        digitalWrite(RELAY3_PIN, rs["3"] ? LOW : HIGH);
        digitalWrite(RELAY4_PIN, rs["4"] ? LOW : HIGH);
      }
    }

    // Only update relays normally if no sequence is running
    if (currentSequence == 0) {
      JsonObject rs = doc["relays"];
      digitalWrite(RELAY1_PIN, rs["1"] ? LOW : HIGH);
      digitalWrite(RELAY2_PIN, rs["2"] ? LOW : HIGH);
      digitalWrite(RELAY3_PIN, rs["3"] ? LOW : HIGH);
      digitalWrite(RELAY4_PIN, rs["4"] ? LOW : HIGH);
    }
  }
  http.end();
}

void sendSensorData() {
  float h = dht.readHumidity();
  float t = dht.readTemperature();

  // Biar heartbeat tetep jalan walau DHT error (tulis 0)
  if (isnan(h) || isnan(t)) {
    Serial.println("Failed to read from DHT sensor! Heartbeat only.");
    h = 0;
    t = 0;
  }

  HTTPClient http;
  String url = String(serverUrl) + "/api/update-sensor";
  
  http.begin(url);
  http.addHeader("Content-Type", "application/json");

  String jsonPayload = "{\"temp\":" + String(t) + ",\"humidity\":" + String(h) + "}";
  
  int httpCode = http.POST(jsonPayload);
  http.end();
}
