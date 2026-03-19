/*
 * Resurrected AI — Spirit Board Firmware
 * Hardware : LilyGo T-Embed Plus (ESP32-S3, ST7789V 170×320, EC11 encoder)
 * Vibe-coded with Microsoft Copilot, compiled via GitHub Actions.
 *
 * Before flashing copy firmware/src/config.h.example → firmware/src/config.h
 * and fill in your WiFi credentials and OpenAI API key.
 */

#include <Arduino.h>
#include <TFT_eSPI.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "config.h"

// ─── Display ─────────────────────────────────────────────────────────────────
TFT_eSPI tft = TFT_eSPI();

// ─── RGB565 colour palette ────────────────────────────────────────────────────
static const uint16_t COL_BG         = 0x0000; // Black
static const uint16_t COL_HEADER_BG  = 0x4010; // Dark indigo
static const uint16_t COL_ACCENT     = 0x780F; // Medium purple
static const uint16_t COL_SPIRIT     = 0xFEA0; // Gold — spirit text
static const uint16_t COL_QUESTION   = 0x07FF; // Cyan — selected question
static const uint16_t COL_INACTIVE   = 0x4208; // Dim grey — unselected items
static const uint16_t COL_GOOD       = 0x07E0; // Green — WiFi OK
static const uint16_t COL_BAD        = 0xF800; // Red — error / no WiFi
static const uint16_t COL_WHITE      = 0xFFFF;

// ─── Questions ────────────────────────────────────────────────────────────────
static const char* QUESTIONS[] = {
    "Is anyone there?",
    "What message do you have for me?",
    "What lies beyond death?",
    "Reveal your hidden wisdom.",
    "What does the future hold?",
    "Who speaks from beyond?",
    "What secrets do you keep?",
    "Speak your truth to me.",
    "Am I on the right path?",
    "What do the spirits see?"
};
static const int NUM_QUESTIONS = sizeof(QUESTIONS) / sizeof(QUESTIONS[0]);

// ─── Encoder state (interrupt-driven) ────────────────────────────────────────
static volatile int     encoderCount  = 0;
static volatile bool    btnPressed    = false;
static volatile uint8_t lastEncoded   = 0;

void IRAM_ATTR encoderISR() {
    // Gray-code quadrature decoder
    uint8_t encoded = (digitalRead(PIN_ENCODER_A) << 1) | digitalRead(PIN_ENCODER_B);
    uint8_t sum     = (lastEncoded << 2) | encoded;
    if (sum == 0x0D || sum == 0x04 || sum == 0x02 || sum == 0x0B) encoderCount++;
    if (sum == 0x0E || sum == 0x07 || sum == 0x01 || sum == 0x08) encoderCount--;
    lastEncoded = encoded;
}

void IRAM_ATTR btnISR() {
    static unsigned long lastMs = 0;
    unsigned long now = millis();
    if (now - lastMs > 200) {   // 200 ms debounce
        btnPressed = true;
        lastMs     = now;
    }
}

// ─── App state ────────────────────────────────────────────────────────────────
enum State { S_BOOT, S_WIFI, S_IDLE, S_ASKING, S_RESPONSE };
static State       appState      = S_BOOT;
static int         selectedQ     = 0;
static int         lastEncCount  = 0;
static String      spiritReply   = "";

// ─── Forward declarations ─────────────────────────────────────────────────────
void setupEncoder();
void setupDisplay();
void drawBootScreen();
void drawWiFiScreen(bool connected);
void drawIdleScreen();
void drawQuestionList();
void drawAskingScreen();
void drawResponseScreen(const String& resp);
String callOpenAI(const char* question);
void printWrapped(const String& text, int x, int y, int maxX,
                  int lineH, uint16_t fg, uint16_t bg, int delayMs);

// ═══════════════════════════════════════════════════════════════════════════════
void setup() {
    Serial.begin(115200);
    Serial.println("[Resurrected AI] booting…");

    setupEncoder();
    setupDisplay();

    drawBootScreen();
    delay(2500);

    // ── WiFi ──
    appState = S_WIFI;
    drawWiFiScreen(false);

    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) {
        delay(500);
        Serial.print('.');
        // Animate dots on screen
        tft.fillCircle(25 + (i % 8) * 15, 220, 4, COL_ACCENT);
    }
    Serial.println();

    bool wifiOk = (WiFi.status() == WL_CONNECTED);
    drawWiFiScreen(wifiOk);
    if (wifiOk) Serial.println("[WiFi] connected: " + WiFi.localIP().toString());
    else         Serial.println("[WiFi] FAILED — API calls will not work");
    delay(1200);

    appState = S_IDLE;
    drawIdleScreen();
}

// ═══════════════════════════════════════════════════════════════════════════════
void loop() {
    // ── Encoder rotation ──
    int currentCount = encoderCount;
    if (currentCount != lastEncCount && appState == S_IDLE) {
        int diff = currentCount - lastEncCount;
        selectedQ     = (selectedQ + diff % NUM_QUESTIONS + NUM_QUESTIONS) % NUM_QUESTIONS;
        lastEncCount  = currentCount;
        drawQuestionList();
    }

    // ── Button press ──
    if (btnPressed) {
        btnPressed = false;

        if (appState == S_IDLE) {
            appState = S_ASKING;
            drawAskingScreen();

            if (WiFi.status() == WL_CONNECTED) {
                spiritReply = callOpenAI(QUESTIONS[selectedQ]);
            } else {
                // Attempt reconnect once
                WiFi.reconnect();
                delay(3000);
                spiritReply = (WiFi.status() == WL_CONNECTED)
                    ? callOpenAI(QUESTIONS[selectedQ])
                    : "The connection to the spirit realm has been severed… the veil is too thick.";
            }

            appState = S_RESPONSE;
            drawResponseScreen(spiritReply);

        } else if (appState == S_RESPONSE) {
            appState = S_IDLE;
            drawIdleScreen();
        }
    }

    delay(20);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── Hardware init ────────────────────────────────────────────────────────────

void setupEncoder() {
    pinMode(PIN_ENCODER_A,   INPUT_PULLUP);
    pinMode(PIN_ENCODER_B,   INPUT_PULLUP);
    pinMode(PIN_ENCODER_BTN, INPUT_PULLUP);
    attachInterrupt(digitalPinToInterrupt(PIN_ENCODER_A),   encoderISR, CHANGE);
    attachInterrupt(digitalPinToInterrupt(PIN_ENCODER_B),   encoderISR, CHANGE);
    attachInterrupt(digitalPinToInterrupt(PIN_ENCODER_BTN), btnISR,     FALLING);
}

void setupDisplay() {
    tft.init();
    tft.setRotation(0);         // Portrait 170×320
    tft.fillScreen(COL_BG);
    pinMode(PIN_TFT_BL, OUTPUT);
    digitalWrite(PIN_TFT_BL, HIGH);
    tft.setTextWrap(false);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── Screens ──────────────────────────────────────────────────────────────────

void drawBootScreen() {
    tft.fillScreen(COL_BG);

    // Starfield background
    randomSeed(42);
    for (int i = 0; i < 60; i++)
        tft.drawPixel(random(170), random(320), COL_INACTIVE);

    // Title
    tft.setTextColor(COL_ACCENT, COL_BG);
    tft.setTextSize(2);
    tft.setCursor(8, 55);  tft.print("RESURRECTED");
    tft.setCursor(35, 78); tft.print("SPIRIT");

    tft.setTextColor(COL_SPIRIT, COL_BG);
    tft.setTextSize(3);
    tft.setCursor(55, 112); tft.print("AI");

    // Decorative lines
    tft.drawFastHLine(10, 148, 150, COL_ACCENT);
    tft.drawFastHLine(10, 151, 150, COL_HEADER_BG);

    tft.setTextColor(COL_INACTIVE, COL_BG);
    tft.setTextSize(1);
    tft.setCursor(22, 163); tft.print("LilyGo T-Embed Plus");
    tft.setCursor(38, 176); tft.print("Spirit Board v1.0");

    tft.setTextColor(COL_ACCENT, COL_BG);
    tft.setTextSize(2);
    tft.setCursor(52, 240); tft.print("* * *");
}

void drawWiFiScreen(bool connected) {
    tft.fillScreen(COL_BG);
    tft.setTextColor(COL_ACCENT, COL_BG);
    tft.setTextSize(1);
    tft.setCursor(15, 90);  tft.print("Reaching across");
    tft.setCursor(15, 103); tft.print("the veil…");

    tft.setCursor(15, 130);
    tft.setTextColor(COL_INACTIVE, COL_BG);
    tft.print("Network: ");
    tft.setTextColor(COL_SPIRIT, COL_BG);
    tft.print(WIFI_SSID);

    if (connected) {
        tft.setTextColor(COL_GOOD, COL_BG);
        tft.setCursor(30, 200); tft.print("Connected!");
        tft.setCursor(15, 215);
        tft.setTextColor(COL_INACTIVE, COL_BG);
        tft.print(WiFi.localIP().toString());
    } else {
        tft.setTextColor(COL_BAD, COL_BG);
        tft.setCursor(15, 200); tft.print("Connection failed.");
        tft.setTextColor(COL_INACTIVE, COL_BG);
        tft.setCursor(10, 216); tft.print("Offline mode active.");
    }
}

void drawIdleScreen() {
    tft.fillScreen(COL_BG);

    // ── Header ──
    tft.fillRect(0, 0, 170, 34, COL_HEADER_BG);
    tft.setTextColor(COL_SPIRIT, COL_HEADER_BG);
    tft.setTextSize(1);
    tft.setCursor(16, 6);  tft.print("~~ SPIRIT  BOARD ~~");
    tft.setCursor(22, 19); tft.print("Ask the beyond…");

    // WiFi dot
    uint16_t dotCol = (WiFi.status() == WL_CONNECTED) ? COL_GOOD : COL_BAD;
    tft.fillCircle(162, 10, 4, dotCol);

    tft.drawFastHLine(0, 36, 170, COL_ACCENT);

    drawQuestionList();

    // ── Footer ──
    tft.drawFastHLine(0, 305, 170, COL_ACCENT);
    tft.setTextColor(COL_INACTIVE, COL_BG);
    tft.setTextSize(1);
    tft.setCursor(10, 310); tft.print("Turn=Select  Press=Ask");
}

void drawQuestionList() {
    // Clear list area
    tft.fillRect(0, 38, 170, 265, COL_BG);

    const int VISIBLE = 7;
    const int ITEM_H  = 36;
    const int CHARS   = 26;   // characters per line in question area

    int startIdx = selectedQ - 3;
    if (startIdx < 0) startIdx = 0;
    if (startIdx + VISIBLE > NUM_QUESTIONS) startIdx = NUM_QUESTIONS - VISIBLE;

    for (int i = 0; i < VISIBLE; i++) {
        int idx = startIdx + i;
        if (idx >= NUM_QUESTIONS) break;

        int y = 40 + i * ITEM_H;

        if (idx == selectedQ) {
            tft.fillRect(2, y, 164, ITEM_H - 2, COL_HEADER_BG);
            tft.setTextColor(COL_SPIRIT, COL_HEADER_BG);
            // Small arrow indicator
            tft.fillTriangle(5, y + 9, 5, y + 23, 12, y + 16, COL_ACCENT);
        } else {
            tft.setTextColor(COL_INACTIVE, COL_BG);
        }

        tft.setTextSize(1);
        String q = String(QUESTIONS[idx]);
        if (q.length() > (size_t)CHARS) {
            tft.setCursor(16, y + 6);  tft.print(q.substring(0, CHARS));
            tft.setCursor(16, y + 18); tft.print(q.substring(CHARS));
        } else {
            tft.setCursor(16, y + 12); tft.print(q);
        }
    }

    // Scrollbar
    if (NUM_QUESTIONS > VISIBLE) {
        tft.fillRect(167, 40, 2, 263, COL_HEADER_BG);
        int barH = 263 * VISIBLE / NUM_QUESTIONS;
        int barY = 40 + (263 - barH) * selectedQ / (NUM_QUESTIONS - 1);
        tft.fillRect(167, barY, 2, barH, COL_ACCENT);
    }
}

void drawAskingScreen() {
    tft.fillScreen(COL_BG);

    // Starfield
    randomSeed(millis());
    for (int i = 0; i < 40; i++)
        tft.drawPixel(random(170), random(320), COL_INACTIVE);

    tft.setTextColor(COL_ACCENT, COL_BG);
    tft.setTextSize(1);
    tft.setCursor(15, 75);  tft.print("Consulting the spirits");
    tft.setCursor(40, 88);  tft.print("of the beyond…");

    tft.setTextColor(COL_SPIRIT, COL_BG);
    tft.setTextSize(2);
    tft.setCursor(60, 120); tft.print("· · ·");

    tft.setTextColor(COL_QUESTION, COL_BG);
    tft.setTextSize(1);
    tft.setCursor(10, 175); tft.print("You asked:");

    String q = String(QUESTIONS[selectedQ]);
    printWrapped(q, 10, 190, 160, 14, COL_WHITE, COL_BG, 0);

    // Animated waiting dots
    for (int i = 0; i < 3; i++) {
        tft.fillCircle(65 + i * 22, 268, 6, COL_ACCENT);
        delay(250);
        tft.fillCircle(65 + i * 22, 268, 6, COL_SPIRIT);
    }
}

void drawResponseScreen(const String& resp) {
    tft.fillScreen(COL_BG);

    // ── Header ──
    tft.fillRect(0, 0, 170, 28, COL_HEADER_BG);
    tft.setTextColor(COL_ACCENT, COL_HEADER_BG);
    tft.setTextSize(1);
    tft.setCursor(15, 5);  tft.print("~ THE SPIRIT SPEAKS ~");
    tft.setCursor(50, 17); tft.print("~ ~ ~ ~ ~ ~");
    tft.drawFastHLine(0, 30, 170, COL_ACCENT);

    // ── Typewriter response ──
    String text = resp;
    if (text.length() > 480) text = text.substring(0, 477) + "…";
    printWrapped(text, 5, 40, 164, 14, COL_SPIRIT, COL_BG, 18);

    // ── Footer ──
    tft.drawFastHLine(0, 303, 170, COL_ACCENT);
    tft.setTextColor(COL_INACTIVE, COL_BG);
    tft.setTextSize(1);
    tft.setCursor(30, 310); tft.print("Press to return");
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── Word-wrapped text printer with optional typewriter delay ─────────────────
//   text    — string to print
//   x,y     — top-left start position
//   maxX    — right edge (wrap before this x)
//   lineH   — pixel height of one line
//   fg,bg   — foreground / background colour
//   delayMs — milliseconds between characters (0 = instant)
void printWrapped(const String& text, int x, int y, int maxX,
                  int lineH, uint16_t fg, uint16_t bg, int delayMs) {
    const int charW = 6; // TFT_eSPI size-1 character width
    int curX = x;
    int curY = y;
    int len  = text.length();
    int i    = 0;

    tft.setTextColor(fg, bg);
    tft.setTextSize(1);

    while (i < len) {
        char c = text[i];

        if (c == '\n') {
            curX = x;
            curY += lineH;
            i++;
            continue;
        }

        // Skip leading spaces at line start
        if (c == ' ' && curX == x) { i++; continue; }

        // Find next word boundary to decide wrapping
        if (c != ' ') {
            int wordEnd = i;
            while (wordEnd < len && text[wordEnd] != ' ' && text[wordEnd] != '\n')
                wordEnd++;
            int wordPx = (wordEnd - i) * charW;
            if (curX + wordPx > maxX && curX != x) {
                curX = x;
                curY += lineH;
                if (curY > 295) return;
            }
        }

        if (curY > 295) return;

        tft.drawChar(curX, curY, c, fg, bg, 1);
        curX += charW;

        if (delayMs > 0) delay(delayMs);

        i++;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── OpenAI API call ──────────────────────────────────────────────────────────
String callOpenAI(const char* question) {
    WiFiClientSecure secureClient;
    secureClient.setInsecure();   // skip TLS cert verification (suitable for DIY)

    HTTPClient http;
    http.setTimeout(18000);

    if (!http.begin(secureClient, "https://api.openai.com/v1/chat/completions")) {
        Serial.println("[OpenAI] http.begin failed");
        return "The portal to beyond is closed…";
    }

    http.addHeader("Content-Type",  "application/json");
    http.addHeader("Authorization", String("Bearer ") + OPENAI_API_KEY);

    // ── Build request JSON ──
    DynamicJsonDocument reqDoc(1024);
    reqDoc["model"]      = OPENAI_MODEL;
    reqDoc["max_tokens"] = OPENAI_MAX_TOKENS;
    reqDoc["temperature"] = OPENAI_TEMPERATURE;

    JsonArray msgs  = reqDoc.createNestedArray("messages");
    JsonObject sys  = msgs.createNestedObject();
    sys["role"]     = "system";
    sys["content"]  = SPIRIT_PERSONA;
    JsonObject user = msgs.createNestedObject();
    user["role"]    = "user";
    user["content"] = question;

    String body;
    serializeJson(reqDoc, body);
    Serial.println("[OpenAI] → " + body);

    int code = http.POST(body);
    Serial.printf("[OpenAI] HTTP %d\n", code);

    if (code != 200) {
        String err = http.getString();
        http.end();
        Serial.println("[OpenAI] error body: " + err);
        return "The spirit's voice was silenced… (HTTP " + String(code) + ")";
    }

    String payload = http.getString();
    http.end();
    Serial.println("[OpenAI] ← " + payload.substring(0, 200));

    // ── Parse response ──
    DynamicJsonDocument resDoc(4096);
    DeserializationError err = deserializeJson(resDoc, payload);
    if (err) {
        Serial.println("[OpenAI] JSON error: " + String(err.c_str()));
        return "The spirit's words were garbled beyond understanding…";
    }

    const char* content = resDoc["choices"][0]["message"]["content"];
    if (!content || strlen(content) == 0)
        return "Silence from beyond the veil…";

    return String(content);
}
