#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <WebServer.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "DHT.h"

// ==========================================
// 📶 KONFIGURASI WIFI & JARINGAN
// ==========================================
const char* ssid = "Kocakk";
const char* password = "11223344";

// ==========================================
// ☁️ KONFIGURASI BACKEND CLOUD
// ==========================================
// Ganti dengan URL server backend Anda saat ini agar Web Dashboard & Bot Telegram sinkron!
// URL Cloud Anda: https://ais-pre-tt5eohrymap33mccj2v5op-817384740536.asia-east1.run.app
const char* serverUrl = "https://ais-pre-tt5eohrymap33mccj2v5op-817384740536.asia-east1.run.app";

// ==========================================
// 🤖 KONFIGURASI TELEGRAM BOT (OPSIONAL / DIRECT)
// ==========================================
// Catatan Arsitektur:
// Perintah bot Anda saat ini diproses secara instan dan andal oleh server Node.js (Vercel/Cloud).
// Ini adalah metode TERBAIK & paling kencang karena tidak membebani ESP32 dengan koneksi SSL Telegram yang berat.
// Namun, jika Anda ingin menyimpannya di sini sebagai dokumentasi/referensi, Anda bisa mengisinya:
const char* botToken = "YOUR_TELEGRAM_BOT_TOKEN";
const char* chatID = "YOUR_TELEGRAM_CHAT_ID";

// ==========================================
// 📌 KONFIGURASI PIN OUT (Sesuai Board Anda)
// ==========================================
#define DHTPIN 4
#define DHTTYPE DHT11 // Ganti ke DHT22 jika sensor Anda berwarna putih

#define RELAY1_PIN 5
#define RELAY2_PIN 19
#define RELAY3_PIN 18
#define RELAY4_PIN 23

DHT dht(DHTPIN, DHTTYPE);
WebServer server(80);

// Prototipe Fungsi WebServer
void handleStatus();
void handleRelayControl();
void handleSpeedControl();
void handleSequenceControl();
void sendTelegramMessage(String message);

void setup() {
  Serial.begin(115200);
  Serial.println("\n===== ESP32 SMART HOME SYSTEM STARTING =====");

  // Set Relay Pin sebagai OUTPUT
  pinMode(RELAY1_PIN, OUTPUT);
  pinMode(RELAY2_PIN, OUTPUT);
  pinMode(RELAY3_PIN, OUTPUT);
  pinMode(RELAY4_PIN, OUTPUT);

  // Inisialisasi awal: Matikan semua relay (Active Low: HIGH = OFF)
  digitalWrite(RELAY1_PIN, HIGH); 
  digitalWrite(RELAY2_PIN, HIGH);
  digitalWrite(RELAY3_PIN, HIGH);
  digitalWrite(RELAY4_PIN, HIGH);

  dht.begin();
  initWiFi();

  // Registrasi Endpoint WebServer Lokal (Untuk LAN Direct Control)
  server.on("/api/status", handleStatus);
  server.on("/api/relay", handleRelayControl);
  server.on("/api/speed", handleSpeedControl);
  server.on("/api/sequence", handleSequenceControl);
  
  // Custom CORS Header Handling
  server.enableCORS(true);
  server.begin();
  Serial.println("🌐 [LAN LOCAL] HTTP WebServer berjalan di Port 80!");
}

void initWiFi() {
  WiFi.begin(ssid, password);
  Serial.print("📶 Menghubungkan ke WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\n🟢 WiFi Terhubung!");
  Serial.print("📌 IP Address ESP32: ");
  Serial.println(WiFi.localIP()); 
}

unsigned long lastUpdate = 0;
const int updateInterval = 10000; // Kirim data sensor setiap 10 detik

unsigned long lastRelayCheck = 0;
const int relayCheckInterval = 3000; // Cek status relay setiap 3 detik untuk sync cloud agar ESP32 lancar & tidak lag/disconnect

int currentSequence = 0;
unsigned long lastSeqStep = 0;
int seqStep = 0;
int sequenceDelay = 200; // Delay pola variasi relay (ms)
unsigned long lastLanActivity = 0; // Waktu aktivitas LAN lokal terakhir untuk menghindari tabrakan sync (race condition)
String pendingTelegramMsg = "";    // Antrian pesan Telegram agar pengiriman tidak memblokir respon HTTP lokal

// Handler untuk memberikan status pembacaan sensor dan relay langsung via LAN (CORS-enabled)
void handleStatus() {
  float h = dht.readHumidity();
  float t = dht.readTemperature();
  if (isnan(h) || isnan(t)) { h = 0; t = 0; }

  DynamicJsonDocument doc(512);
  doc["temp"] = t;
  doc["humidity"] = h;
  doc["sequence"] = currentSequence;
  doc["sequenceDelay"] = sequenceDelay;
  
  JsonObject rs = doc.createNestedObject("relays");
  // Active Low: LOW = Menyala (ON = true), HIGH = Mati (OFF = false)
  rs["1"] = (digitalRead(RELAY1_PIN) == LOW);
  rs["2"] = (digitalRead(RELAY2_PIN) == LOW);
  rs["3"] = (digitalRead(RELAY3_PIN) == LOW);
  rs["4"] = (digitalRead(RELAY4_PIN) == LOW);

  String response;
  serializeJson(doc, response);

  lastLanActivity = millis(); // Perbarui log aktivitas lokal untuk menghindari tabrakan sync (race condition)
  server.send(200, "application/json", response);
}

// Handler untuk kontrol relay instan dari web dashboard lokal (CORS-enabled)
void handleRelayControl() {
  if (server.hasArg("id") && server.hasArg("state")) {
    int id = server.arg("id").toInt();
    String state = server.arg("state");
    bool pinValue = (state == "on" || state == "1") ? LOW : HIGH; // Active Low (LOW = ON)

    if (id == 1) digitalWrite(RELAY1_PIN, pinValue);
    else if (id == 2) digitalWrite(RELAY2_PIN, pinValue);
    else if (id == 3) digitalWrite(RELAY3_PIN, pinValue);
    else if (id == 4) digitalWrite(RELAY4_PIN, pinValue);

    String statusText = (pinValue == LOW) ? "MENYALA 🟢" : "MATI 🔴";
    Serial.print("⚡ LAN Action: Relay ");
    Serial.print(id);
    Serial.println(" -> " + statusText);

    // Antrikan pengiriman notifikasi ke Telegram tanpa memblokir respon HTTP instan LAN
    pendingTelegramMsg = "🔌 *[ESP32 Direct]* Relay " + String(id) + " diubah via LAN menjadi *" + statusText + "*";

    lastLanActivity = millis(); // Perbarui log aktivitas lokal
    server.send(200, "application/json", "{\"status\":\"ok\",\"message\":\"Relay updated directly via LAN\"}");
  } else {
    server.send(400, "application/json", "{\"error\":\"Missing arguments id or state\"}");
  }
}

// Handler untuk kontrol kecepatan variasi instan dari web dashboard lokal (CORS-enabled)
void handleSpeedControl() {
  if (server.hasArg("delay")) {
    int delayVal = server.arg("delay").toInt();
    if (delayVal >= 50 && delayVal <= 2000) {
      sequenceDelay = delayVal;
      lastLanActivity = millis(); // Perbarui log aktivitas lokal
      server.send(200, "application/json", "{\"status\":\"ok\",\"sequenceDelay\":" + String(sequenceDelay) + "}");
    } else {
      server.send(400, "application/json", "{\"error\":\"Delay bounds are 50ms - 2000ms\"}");
    }
  } else {
    server.send(400, "application/json", "{\"error\":\"Missing delay query param\"}");
  }
}

// Handler untuk kontrol pola variasi instan dari web dashboard lokal (CORS-enabled)
void handleSequenceControl() {
  if (server.hasArg("mode")) {
    int mode = server.arg("mode").toInt();
    if (mode == 0 || mode == 1 || mode == 2) {
      currentSequence = mode;
      seqStep = 0;
      if (currentSequence == 0) {
        allRelaysOff();
      }
      String patternName = (currentSequence == 0) ? "NONAKTIF ⏹️" : (currentSequence == 1) ? "Pola 1-2-3-4 🔄" : "Pola 4-3-2-1 🔄";
      Serial.print("⚡ LAN Action: Pola variasi diubah ke " + patternName);
      
      // Antrikan pengiriman notifikasi ke Telegram tanpa memblokir respon HTTP instan LAN
      pendingTelegramMsg = "⚡ *[ESP32 Direct]* Pola Variasi diubah via LAN menjadi *" + patternName + "*";

      lastLanActivity = millis(); // Perbarui log aktivitas lokal untuk mencegah overwrite delay
      server.send(200, "application/json", "{\"status\":\"ok\",\"sequence\":" + String(currentSequence) + "}");
    } else {
      server.send(400, "application/json", "{\"error\":\"Invalid mode\"}");
    }
  } else {
    server.send(400, "application/json", "{\"error\":\"Missing mode query param\"}");
  }
}

void loop() {
  server.handleClient(); // Tangani request dari browser secara instan (Direct LAN)
  
  if (WiFi.status() == WL_CONNECTED) {
    // Jalankan pengiriman pesan Telegram jika ada antrian secara asinkron (diluar request handler local)
    if (pendingTelegramMsg != "") {
      sendTelegramMessage(pendingTelegramMsg);
      pendingTelegramMsg = ""; // Kosongkan antrian setelah dikirim
    }
    // Sync status relay dengan Cloud Server
    // Berikan jeda grace period jika baru saja ada aktivitas LAN lokal agar sinkronisasi tidak tabrakan (race condition)
    if (millis() - lastLanActivity > 8000) {
      unsigned long currentInterval = (currentSequence == 0) ? 5000 : 15000;
      if (millis() - lastRelayCheck > currentInterval) {
        checkRelayStatus();
        lastRelayCheck = millis();
      }
    }
    
    // Auto Sequence Logic (Pola Variasi Relay)
    if (currentSequence == 1) { // Pola 1-2-3-4
      if (millis() - lastSeqStep > sequenceDelay) {
        allRelaysOff();
        if (seqStep == 0) digitalWrite(RELAY1_PIN, LOW);
        else if (seqStep == 1) digitalWrite(RELAY2_PIN, LOW);
        else if (seqStep == 2) digitalWrite(RELAY3_PIN, LOW);
        else if (seqStep == 3) digitalWrite(RELAY4_PIN, LOW);
        seqStep = (seqStep + 1) % 4;
        lastSeqStep = millis();
      }
    } else if (currentSequence == 2) { // Pola 4-3-2-1
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

    // Kirim data sensor ke Cloud Server setiap 10 detik
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
  WiFiClientSecure client;
  client.setInsecure(); // Mengabaikan validasi rantai sertifikat SSL agar hemat memori & hemat CPU (super cepat!)
  HTTPClient http;
  String url = String(serverUrl) + "/api/relays";
  
  http.begin(client, url);
  http.setTimeout(1000); // Batasi waktu tunggu agar tidak membekukan Web Server lokal
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
      Serial.print("🔄 Pola variasi berubah ke: Pola ");
      Serial.println(currentSequence);
      if (currentSequence == 0) {
        // Reset ke status normal relay jika variasi dihentikan
        JsonObject rs = doc["relays"];
        digitalWrite(RELAY1_PIN, rs["1"] ? LOW : HIGH);
        digitalWrite(RELAY2_PIN, rs["2"] ? LOW : HIGH);
        digitalWrite(RELAY3_PIN, rs["3"] ? LOW : HIGH);
        digitalWrite(RELAY4_PIN, rs["4"] ? LOW : HIGH);
      }
    }

    // Hanya update status relay jika TIDAK ADA pola variasi berjalan
    if (currentSequence == 0) {
      JsonObject rs = doc["relays"];
      digitalWrite(RELAY1_PIN, rs["1"] ? LOW : HIGH);
      digitalWrite(RELAY2_PIN, rs["2"] ? LOW : HIGH);
      digitalWrite(RELAY3_PIN, rs["3"] ? LOW : HIGH);
      digitalWrite(RELAY4_PIN, rs["4"] ? LOW : HIGH);
    }
  } else {
    if (httpCode == 404) {
      static bool warnedRelay = false;
      if (!warnedRelay) {
        Serial.println("ℹ️ [CLOUDSYNC] HTTP 404: Server Cloud AI Studio terproteksi keamanan sandbox.");
        Serial.println("👉 Ini NORMAL di AI Studio Dev. Aktifkan 'Mode Direct IP' & isi IP ESP32 di Web Dashboard Anda untuk kontrol lokal 0ms!");
        warnedRelay = true;
      }
    } else {
      Serial.print("⚠️ [CLOUDSYNC] Gagal mengambil status. Error: ");
      Serial.println(httpCode);
    }
  }
  http.end();
}

void sendSensorData() {
  float h = dht.readHumidity();
  float t = dht.readTemperature();

  if (isnan(h) || isnan(t)) {
    Serial.println("❌ Gagal membaca sensor DHT11!");
    h = 0;
    t = 0;
  }

  WiFiClientSecure client;
  client.setInsecure(); // Mengabaikan validasi rantai sertifikat SSL agar hemat memori & hemat CPU (super cepat!)
  HTTPClient http;
  String url = String(serverUrl) + "/api/update-sensor";
  
  http.begin(client, url);
  http.setTimeout(1200); // Batasi waktu tunggu agar tidak membekukan Web Server lokal
  http.addHeader("Content-Type", "application/json");

  String jsonPayload = "{\"temp\":" + String(t) + ",\"humidity\":" + String(h) + "}";
  
  int httpCode = http.POST(jsonPayload);
  if (httpCode == 404) {
    static bool warnedSensor = false;
    if (!warnedSensor) {
      Serial.println("ℹ️ [DHT11] HTTP 404: Cloud terproteksi keamanan sandbox. Data sensor akan dibaca langsung oleh Web Browser (Direct IP Mode).");
      warnedSensor = true;
    }
  } else if (httpCode != 200) {
    Serial.print("⚠️ Gagal mengirim data sensor. HTTP Code: ");
    Serial.println(httpCode);
  } else {
    Serial.println("🚀 Data sensor berhasil dikirim ke Cloud Server!");
  }
  http.end();
}

// Fungsi asinkron untuk mengirim pesan/alert Telegram secara aman & langsung dari ESP32
void sendTelegramMessage(String message) {
  if (strcmp(botToken, "YOUR_TELEGRAM_BOT_TOKEN") == 0 || strcmp(chatID, "YOUR_TELEGRAM_CHAT_ID") == 0) {
    Serial.println("ℹ️ [TELEGRAM ESP32] Bot Token / Chat ID belum dikonfigurasi di ESP32. Kirim pesan dilewati.");
    return;
  }
  
  WiFiClientSecure client;
  client.setInsecure(); // Mengabaikan validasi rantai sertifikat SSL agar hemat memori & hemat CPU (super cepat!)
  HTTPClient http;
  
  String url = "https://api.telegram.org/bot" + String(botToken) + "/sendMessage";
  http.begin(client, url);
  http.setTimeout(2500); // Batasi timeout agar tidak menggantung program
  http.addHeader("Content-Type", "application/json");
  
  DynamicJsonDocument doc(256);
  doc["chat_id"] = chatID;
  doc["text"] = message;
  doc["parse_mode"] = "Markdown";
  
  String payload;
  serializeJson(doc, payload);
  
  int httpCode = http.POST(payload);
  if (httpCode == 200) {
    Serial.println("🚀 [TELEGRAM ESP32] Pesan berhasil dikirim langsung dari ESP32!");
  } else {
    Serial.print("⚠️ [TELEGRAM ESP32] Gagal mengirim pesan. Code: ");
    Serial.println(httpCode);
  }
  http.end();
}
