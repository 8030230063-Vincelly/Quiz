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
#define DHTTYPE DHT11 // GANTI ke DHT22 jika sensor Anda berwarna Putih

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

// --- OPTIMASI KONEKSI (HTTP KEEP-ALIVE) ---
// Dengan memindahkan HTTPClient ke scope global, kita dapat menjaga koneksi TCP/SSL tetap terbuka.
// Hal ini menghilangkan delay handshake TLS (~500-800ms) pada setiap putaran cek relay.
HTTPClient httpRelay;
bool isRelayHttpInitialized = false;

unsigned long lastRelayCheck = 0;
const int relayCheckInterval = 400; // Cek status relay setiap 400ms (0.4 detik) untuk respons instan tanpa lag!

int currentSequence = 0;
unsigned long lastSeqStep = 0;
int seqStep = 0;

void loop() {
  if (WiFi.status() == WL_CONNECTED) {
    // Cek status relay setiap 400ms untuk respons instan
    if (millis() - lastRelayCheck > relayCheckInterval) {
      checkRelayStatus();
      lastRelayCheck = millis();
    }
    
    // Handle Sequence Logic
    if (currentSequence == 1) { // 1-2-3-4
      if (millis() - lastSeqStep > 500) {
        allRelaysOff();
        if (seqStep == 0) digitalWrite(RELAY1_PIN, LOW);
        else if (seqStep == 1) digitalWrite(RELAY2_PIN, LOW);
        else if (seqStep == 2) digitalWrite(RELAY3_PIN, LOW);
        else if (seqStep == 3) digitalWrite(RELAY4_PIN, LOW);
        seqStep = (seqStep + 1) % 4;
        lastSeqStep = millis();
      }
    } else if (currentSequence == 2) { // 4-3-2-1
      if (millis() - lastSeqStep > 500) {
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
  if (!isRelayHttpInitialized) {
    String url = String(serverUrl) + "/api/relays";
    httpRelay.begin(url);
    httpRelay.setReuseConnection(true); // Sangat krusial agar koneksi TCP/SSL tetap aktif
    httpRelay.setTimeout(1500);          // Cegah pembekuan loop jika server agak lambat merespons
    isRelayHttpInitialized = true;
  }
  
  int httpCode = httpRelay.GET();

  if (httpCode == 200) {
    String payload = httpRelay.getString();
    DynamicJsonDocument doc(512);
    deserializeJson(doc, payload);

    int newSeq = doc["sequence"] | 0;
    
    if (newSeq != currentSequence) {
      currentSequence = newSeq;
      seqStep = 0;
      if (currentSequence == 0) {
        // Reset ke status normal relay jika variasi dinonaktifkan
        JsonObject rs = doc["relays"];
        digitalWrite(RELAY1_PIN, rs["1"] ? LOW : HIGH);
        digitalWrite(RELAY2_PIN, rs["2"] ? LOW : HIGH);
        digitalWrite(RELAY3_PIN, rs["3"] ? LOW : HIGH);
        digitalWrite(RELAY4_PIN, rs["4"] ? LOW : HIGH);
      }
    }

    // Hanya ubah status relay jika mode variasi mati (0)
    if (currentSequence == 0) {
      JsonObject rs = doc["relays"];
      digitalWrite(RELAY1_PIN, rs["1"] ? LOW : HIGH);
      digitalWrite(RELAY2_PIN, rs["2"] ? LOW : HIGH);
      digitalWrite(RELAY3_PIN, rs["3"] ? LOW : HIGH);
      digitalWrite(RELAY4_PIN, rs["4"] ? LOW : HIGH);
    }
  } else if (httpCode < 0) {
    // Jika koneksi gagal (misal server reset/timeout), tutup socket dan trigger fresh connect di loop berikutnya
    Serial.printf("[HTTP] GET gagal, error: %s\n", httpRelay.errorToString(httpCode).c_str());
    httpRelay.end();
    isRelayHttpInitialized = false;
  }
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
