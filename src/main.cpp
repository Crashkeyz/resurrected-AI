#include <Arduino.h>

void setup() {
    Serial.begin(115200);
    delay(500);

    Serial.println("ResurrectedAI firmware online.");
}

void loop() {
    // heartbeat blink to prove firmware is running
    static uint32_t last = 0;
    if (millis() - last > 1000) {
        last = millis();
        Serial.println("heartbeat");
    }
}
