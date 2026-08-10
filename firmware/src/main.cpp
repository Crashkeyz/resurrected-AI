/*
 * Resurrected AI — Spirit Board Firmware
 * Hardware : LilyGo T-Embed Plus (ESP32-S3, ST7789V 170×320, EC11 encoder)
 * Vibe-coded with Microsoft Copilot, compiled via GitHub Actions.
 *
 * Before flashing copy firmware/src/config.h.example → firmware/src/config.h
 * and fill in your WiFi credentials and local LLM server address.
 */

#include <Arduino.h>
#include <TFT_eSPI.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include "config.h"

// ─── Display ─────────────────────────────────────────────────────────────────
TFT_eSPI tft = TFT_eSPI();
Preferences prefs;

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
static const int MENU_SWITCH_ITEM = 0;
static const int NUM_MENU_ITEMS = NUM_QUESTIONS + 1; // +1 = switch side item

// ─── Encoder state (interrupt-driven) ────────────────────────────────────────
static volatile int     encoderCount  = 0;
static volatile bool    btnPressed    = false;
static volatile uint8_t lastEncoded   = 0;

void IRAM_ATTR encoderISR() {
    uint8_t encoded = (digitalRead(PIN_ENCODER_A) << 1) | digitalRead(PIN_ENCODER_B);
    uint8_t sum     = (lastEncoded << 2) | encoded;
    if (sum == 0x0D || sum == 0x04 || sum == 0x02 || sum == 0x0B) encoderCount++;
    if (sum == 0x0E || sum == 0x07 || sum == 0x01 || sum == 0x08) encoderCount--;
    lastEncoded = encoded;
}

void IRAM_ATTR btnISR() {
    static unsigned long lastMs = 0;
    unsigned long now = millis();
    if (now - lastMs > 200) {
        btnPressed = true;
        lastMs     = now;
    }
}

// ─── App state ────────────────────────────────────────────────────────────────
enum State { S_SIDE_MENU, S_BOOT, S_WIFI, S_IDLE, S_ASKING, S_RESPONSE, S_BRUCE_DASH };
enum FirmwareSide : uint8_t { SIDE_BRUCE = 0, SIDE_RESURRECTED = 1 };

static State        appState          = S_SIDE_MENU;
static FirmwareSide activeSide        = SIDE_RESURRECTED;
static int          selectedMenuItem  = 1;
static int          selectedSideItem  = 1;
static int          lastEncCount      = 0;
static String       spiritReply       = "";
static uint32_t     bruceHeartbeat    = 0;
static uint32_t     bruceLastBeatMs   = 0;

// ─── Forward declarations ─────────────────────────────────────────────────────
void setupEncoder();
void setupDisplay();
void drawBootScreen();
void drawWiFiScreen(bool connected);
void drawIdleScreen();
void drawQuestionList();
void drawAskingScreen();
void drawResponseScreen(const String& resp);
void drawSideMenu();
void drawBruceScreen();
void enterSelectedSide();
void enterResurrectedSide();
void enterBruceSide();
void saveSelectedSide(FirmwareSide side);
void loadSelectedSide();
String sendToLocalLLM(String message);
void printWrapped(const String& text, int x, int y, int maxX,
                  int lineH, uint16_t fg, uint16_t bg, int delayMs);

// ═══════════════════════════════════════════════════════════════════════════════
void setup() {
    Serial.begin(115200);
    Serial.println("[Firmware] booting…");

    setupEncoder();
    setupDisplay();
    prefs.begin("resurrected", false);
    loadSelectedSide();

    selectedSideItem = (activeSide == SIDE_RESURRECTED) ? 1 : 0;
    appState = S_SIDE_MENU;
    drawSideMenu();
}

// ═══════════════════════════════════════════════════════════════════════════════
void loop() {
    int currentCount = encoderCount;

    if (currentCount != lastEncCount) {
        int diff = currentCount - lastEncCount;
        lastEncCount = currentCount;

        if (appState == S_IDLE) {
            selectedMenuItem = (selectedMenuItem + (diff % NUM_MENU_ITEMS) + NUM_MENU_ITEMS) % NUM_MENU_ITEMS;
            drawQuestionList();
        } else if (appState == S_SIDE_MENU) {
            selectedSideItem = (selectedSideItem + (diff % 2) + 2) % 2;
            drawSideMenu();
        }
    }

    if (btnPressed) {
        btnPressed = false;

        if (appState == S_SIDE_MENU) {
            activeSide = (selectedSideItem == 0) ? SIDE_BRUCE : SIDE_RESURRECTED;
            saveSelectedSide(activeSide);
            enterSelectedSide();
        } else if (appState == S_IDLE) {
            if (selectedMenuItem == MENU_SWITCH_ITEM) {
                selectedSideItem = (activeSide == SIDE_RESURRECTED) ? 1 : 0;
                appState = S_SIDE_MENU;
                drawSideMenu();
            } else {
                appState = S_ASKING;
                drawAskingScreen();

                int qIdx = selectedMenuItem - 1;
                if (WiFi.status() == WL_CONNECTED) {
                    spiritReply = sendToLocalLLM(String(QUESTIONS[qIdx]));
                } else {
                    WiFi.reconnect();
                    delay(3000);
                    spiritReply = (WiFi.status() == WL_CONNECTED)
                        ? sendToLocalLLM(String(QUESTIONS[qIdx]))
                        : "The connection to the spirit realm has been severed… the veil is too thick.";
                }

                appState = S_RESPONSE;
                drawResponseScreen(spiritReply);
            }
        } else if (appState == S_RESPONSE) {
            appState = S_IDLE;
            drawIdleScreen();
        } else if (appState == S_BRUCE_DASH) {
            appState = S_SIDE_MENU;
            selectedSideItem = (activeSide == SIDE_RESURRECTED) ? 1 : 0;
            drawSideMenu();
        }
    }

    if (appState == S_BRUCE_DASH) {
        if (millis() - bruceLastBeatMs > 1000) {
            bruceLastBeatMs = millis();
            bruceHeartbeat++;
            Serial.println("[BRUCE] heartbeat");
            drawBruceScreen();
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
    tft.setRotation(0);
    tft.fillScreen(COL_BG);
    pinMode(PIN_TFT_BL, OUTPUT);
    digitalWrite(PIN_TFT_BL, HIGH);
    tft.setTextWrap(false);
}

void loadSelectedSide() {
    uint8_t raw = prefs.getUChar("fw_side", static_cast<uint8_t>(SIDE_RESURRECTED));
    activeSide = (raw == static_cast<uint8_t>(SIDE_BRUCE)) ? SIDE_BRUCE : SIDE_RESURRECTED;
}

void saveSelectedSide(FirmwareSide side) {
    prefs.putUChar("fw_side", static_cast<uint8_t>(side));
}

void enterSelectedSide() {
    if (activeSide == SIDE_BRUCE) enterBruceSide();
    else                          enterResurrectedSide();
}

void enterBruceSide() {
    appState = S_BRUCE_DASH;
    bruceHeartbeat = 0;
    bruceLastBeatMs = millis();
    drawBruceScreen();
}

void enterResurrectedSide() {
    appState = S_BOOT;
    drawBootScreen();
    delay(1500);

    appState = S_WIFI;
    drawWiFiScreen(false);

    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) {
        delay(250);
        tft.fillCircle(25 + (i % 8) * 15, 220, 4, COL_ACCENT);
    }

    bool wifiOk = (WiFi.status() == WL_CONNECTED);
    drawWiFiScreen(wifiOk);
    delay(800);

    selectedMenuItem = 1;
    appState = S_IDLE;
    drawIdleScreen();
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── Screens ──────────────────────────────────────────────────────────────────
void drawSideMenu() {
    tft.fillScreen(COL_BG);
    tft.fillRect(0, 0, 170, 34, COL_HEADER_BG);
    tft.setTextColor(COL_SPIRIT, COL_HEADER_BG);
    tft.setTextSize(1);
    tft.setCursor(20, 8); tft.print("FIRMWARE SIDE MENU");
    tft.setCursor(30, 20); tft.print("Rotate + Press");

    const char* options[2] = {"Bruce Firmware", "Resurrected AI"};
    for (int i = 0; i < 2; i++) {
        int y = 90 + i * 58;
        bool selected = (i == selectedSideItem);
        tft.fillRect(8, y, 154, 42, selected ? COL_HEADER_BG : COL_BG);
        tft.setTextColor(selected ? COL_SPIRIT : COL_INACTIVE, selected ? COL_HEADER_BG : COL_BG);
        tft.setCursor(16, y + 16);
        tft.print(options[i]);
    }

    tft.setTextColor(COL_INACTIVE, COL_BG);
    tft.setCursor(14, 290); tft.print("Saved side boots by default");
    tft.setCursor(32, 305); tft.print("Press to launch side");
}

void drawBruceScreen() {
    tft.fillScreen(COL_BG);
    tft.fillRect(0, 0, 170, 34, COL_HEADER_BG);
    tft.setTextColor(COL_SPIRIT, COL_HEADER_BG);
    tft.setTextSize(1);
    tft.setCursor(40, 8);  tft.print("BRUCE SIDE");
    tft.setCursor(15, 20); tft.print("Stability launch mode");

    tft.setTextColor(COL_ACCENT, COL_BG);
    tft.setCursor(10, 70); tft.print("System heartbeat:");
    tft.setTextColor(COL_WHITE, COL_BG);
    tft.setCursor(10, 84); tft.print(bruceHeartbeat);

    tft.setTextColor(COL_ACCENT, COL_BG);
    tft.setCursor(10, 118); tft.print("WiFi state:");
    tft.setTextColor((WiFi.status() == WL_CONNECTED) ? COL_GOOD : COL_BAD, COL_BG);
    tft.setCursor(10, 132); tft.print((WiFi.status() == WL_CONNECTED) ? "Connected" : "Offline");

    tft.setTextColor(COL_INACTIVE, COL_BG);
    tft.setCursor(10, 176); tft.print("Use this as stable base.");
    tft.setCursor(10, 200); tft.print("Press button for side menu.");
}

void drawBootScreen() {
    tft.fillScreen(COL_BG);
    randomSeed(42);
    for (int i = 0; i < 60; i++)
        tft.drawPixel(random(170), random(320), COL_INACTIVE);

    tft.setTextColor(COL_ACCENT, COL_BG);
    tft.setTextSize(2);
    tft.setCursor(8, 55);  tft.print("RESURRECTED");
    tft.setCursor(35, 78); tft.print("SPIRIT");

    tft.setTextColor(COL_SPIRIT, COL_BG);
    tft.setTextSize(3);
    tft.setCursor(55, 112); tft.print("AI");

    tft.drawFastHLine(10, 148, 150, COL_ACCENT);
    tft.drawFastHLine(10, 151, 150, COL_HEADER_BG);

    tft.setTextColor(COL_INACTIVE, COL_BG);
    tft.setTextSize(1);
    tft.setCursor(16, 163); tft.print("Resurrected side launch");
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
    tft.fillRect(0, 0, 170, 34, COL_HEADER_BG);
    tft.setTextColor(COL_SPIRIT, COL_HEADER_BG);
    tft.setTextSize(1);
    tft.setCursor(16, 6);  tft.print("~~ SPIRIT  BOARD ~~");
    tft.setCursor(10, 19); tft.print("AI side + mode switch");

    uint16_t dotCol = (WiFi.status() == WL_CONNECTED) ? COL_GOOD : COL_BAD;
    tft.fillCircle(162, 10, 4, dotCol);
    tft.drawFastHLine(0, 36, 170, COL_ACCENT);

    drawQuestionList();

    tft.drawFastHLine(0, 305, 170, COL_ACCENT);
    tft.setTextColor(COL_INACTIVE, COL_BG);
    tft.setTextSize(1);
    tft.setCursor(8, 310); tft.print("Turn=Select  Press=Open");
}

void drawQuestionList() {
    tft.fillRect(0, 38, 170, 265, COL_BG);

    const int VISIBLE = 7;
    const int ITEM_H  = 36;
    const int CHARS   = 26;

    int startIdx = selectedMenuItem - 3;
    if (startIdx < 0) startIdx = 0;
    if (startIdx + VISIBLE > NUM_MENU_ITEMS) startIdx = NUM_MENU_ITEMS - VISIBLE;
    if (startIdx < 0) startIdx = 0;

    for (int i = 0; i < VISIBLE; i++) {
        int idx = startIdx + i;
        if (idx >= NUM_MENU_ITEMS) break;

        int y = 40 + i * ITEM_H;
        bool selected = (idx == selectedMenuItem);

        if (selected) {
            tft.fillRect(2, y, 164, ITEM_H - 2, COL_HEADER_BG);
            tft.setTextColor(COL_SPIRIT, COL_HEADER_BG);
            tft.fillTriangle(5, y + 9, 5, y + 23, 12, y + 16, COL_ACCENT);
        } else {
            tft.setTextColor(COL_INACTIVE, COL_BG);
        }

        tft.setTextSize(1);
        String label = (idx == MENU_SWITCH_ITEM) ? "Switch firmware side..." : String(QUESTIONS[idx - 1]);
        if (label.length() > (size_t)CHARS) {
            tft.setCursor(16, y + 6);  tft.print(label.substring(0, CHARS));
            tft.setCursor(16, y + 18); tft.print(label.substring(CHARS));
        } else {
            tft.setCursor(16, y + 12); tft.print(label);
        }
    }

    if (NUM_MENU_ITEMS > VISIBLE) {
        tft.fillRect(167, 40, 2, 263, COL_HEADER_BG);
        int barH = 263 * VISIBLE / NUM_MENU_ITEMS;
        int barY = 40 + (263 - barH) * selectedMenuItem / (NUM_MENU_ITEMS - 1);
        tft.fillRect(167, barY, 2, barH, COL_ACCENT);
    }
}

void drawAskingScreen() {
    tft.fillScreen(COL_BG);
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

    int qIdx = selectedMenuItem - 1;
    String q = (qIdx >= 0 && qIdx < NUM_QUESTIONS) ? String(QUESTIONS[qIdx]) : String("");
    printWrapped(q, 10, 190, 160, 14, COL_WHITE, COL_BG, 0);
}

void drawResponseScreen(const String& resp) {
    tft.fillScreen(COL_BG);

    tft.fillRect(0, 0, 170, 28, COL_HEADER_BG);
    tft.setTextColor(COL_ACCENT, COL_HEADER_BG);
    tft.setTextSize(1);
    tft.setCursor(15, 5);  tft.print("~ THE SPIRIT SPEAKS ~");
    tft.setCursor(50, 17); tft.print("~ ~ ~ ~ ~ ~");
    tft.drawFastHLine(0, 30, 170, COL_ACCENT);

    String text = resp;
    if (text.length() > 480) text = text.substring(0, 477) + "…";
    printWrapped(text, 5, 40, 164, 14, COL_SPIRIT, COL_BG, 18);

    tft.drawFastHLine(0, 303, 170, COL_ACCENT);
    tft.setTextColor(COL_INACTIVE, COL_BG);
    tft.setTextSize(1);
    tft.setCursor(30, 310); tft.print("Press to return");
}

// ═══════════════════════════════════════════════════════════════════════════════
void printWrapped(const String& text, int x, int y, int maxX,
                  int lineH, uint16_t fg, uint16_t bg, int delayMs) {
    const int charW = 6;
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

        if (c == ' ' && curX == x) {
            i++;
            continue;
        }

        if (c != ' ') {
            int wordEnd = i;
            while (wordEnd < len && text[wordEnd] != ' ' && text[wordEnd] != '\n') wordEnd++;
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
String sendToLocalLLM(String message) {
    WiFiClient client;
    HTTPClient http;

    http.setTimeout(18000);
    String url = String("http://") + LOCAL_LLM_HOST + ":" + LOCAL_LLM_PORT + "/quick_response";
    http.begin(client, url);
    http.addHeader("Content-Type", "application/json");

    message.replace("\\", "\\\\");
    message.replace("\"", "\\\"");

    String payload = "{\"message\":\"" + message + "\"}";
    int httpCode = http.POST(payload);

    if (httpCode > 0) {
        String response = http.getString();
        http.end();
        return response;
    }

    http.end();
    return "Error contacting local LLM.";
}
