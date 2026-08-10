# Resurrected AI — Spirit Board

> **SPIRIT BOARD for LilyGo T-Embed Plus (ESP32-S3)**  
> Vibe-coded with Microsoft Copilot · Compiled via GitHub Actions · Flashed to hardware.

An AI-powered spirit board that runs on the **LilyGo T-Embed Plus** (ESP32-S3, 1.9-inch
ST7789V display, EC11 rotary encoder). Rotate the encoder to choose a question, press to
ask, and watch the AI "spirit" respond in cryptic, otherworldly prose — powered by a
**local LLM resurrection engine** running on your own network.

> **Disclaimer:** Resurrected AI is currently in beta and actively being worked on.  
> No reimbursements are offered.

---

## 🔥 Flash via Browser

**[Terminator ESP32 Flasher](https://crashkeyz.github.io/resurrected-AI/)** — One-click
firmware flashing for all CrashKey ESP32 devices, right in your browser.

1. Open the flasher in Chrome, Edge, or Opera (Web Serial required).
2. Select **Resurrected AI — Spirit Board** from the project list.
3. Click **Fetch Latest Release** — firmware downloads automatically from GitHub Releases.
4. Plug in your LilyGo T-Embed Plus via USB-C (hold BOOT while plugging in for first flash).
5. Click **Connect via USB**, then **Flash**.

> **Note:** GitHub Pages must be enabled in Settings → Pages → Source: `gh-pages` branch.

---

## Hardware

| Component | Part |
|-----------|------|
| Board | LilyGo T-Embed Plus (ESP32-S3, 16 MB flash, 8 MB OPI PSRAM) |
| Display | 1.9″ ST7789V 170 × 320 colour LCD (SPI) |
| Input | EC11 rotary encoder with push-button |
| Connectivity | 2.4 GHz 802.11 b/g/n WiFi |

### Default pin mapping

| Signal | GPIO |
|--------|------|
| TFT MOSI | 11 |
| TFT SCLK | 12 |
| TFT CS   | 10 |
| TFT DC   | 13 |
| TFT RST  | 9  |
| TFT BL (backlight) | 15 |
| Encoder A | 1 |
| Encoder B | 2 |
| Encoder button | 21 |

> If your board revision uses different pins, edit `firmware/src/config.h` before building.

---

## Quick start (local build & flash)

### Prerequisites

- [PlatformIO Core](https://docs.platformio.org/en/latest/core/installation/index.html)
  (`pip install platformio`) **or** [VS Code + PlatformIO IDE extension](https://platformio.org/install/ide?install=vscode)
- USB cable connected to the T-Embed Plus

### 1 — Start the resurrection engine (Python backend)

```bash
cd backend
pip install -r requirements.txt
python resurrection_engine.py
```

The server listens on port **5000**. Note the IP address of the machine running it —
you will need it for the firmware config below.

> **Model:** the engine defaults to `gpt2` for zero-setup testing. Swap `MODEL_NAME`
> in `backend/resurrection_engine.py` for any Hugging Face text-generation model
> (e.g. `TinyLlama/TinyLlama-1.1B-Chat-v1.0`, `microsoft/phi-2`).

### 2 — Configure credentials

```bash
cp firmware/src/config.h.example firmware/src/config.h
```

Open `firmware/src/config.h` and fill in:

```c
#define WIFI_SSID      "YourNetwork"
#define WIFI_PASSWORD  "YourPassword"
#define LOCAL_LLM_HOST "192.168.1.100"   // IP of the machine running resurrection_engine.py
#define LOCAL_LLM_PORT "5000"
```

### 3 — Build

```bash
cd firmware
pio run
```

### 4 — Flash

Hold the **BOOT** button on the board, plug in USB, then:

```bash
cd firmware
pio run --target upload
```

Or use the [esptool.py](https://docs.espressif.com/projects/esptool/en/latest/) web flasher:

```bash
esptool.py --chip esp32s3 --port /dev/ttyUSB0 --baud 921600 \
  write_flash -z \
  0x0000  .pio/build/lilygo-t-embed-plus/bootloader.bin \
  0x8000  .pio/build/lilygo-t-embed-plus/partitions.bin \
  0x10000 .pio/build/lilygo-t-embed-plus/firmware.bin
```

---

## Build via GitHub Actions (CI / release)

Every push triggers the **Build Firmware** workflow
(`.github/workflows/build.yml`).

### Required GitHub Secrets

Go to **Settings → Secrets and variables → Actions** and add:

| Secret | Value |
|--------|-------|
| `WIFI_SSID` | Your WiFi network name |
| `WIFI_PASSWORD` | Your WiFi password |
| `LOCAL_LLM_HOST` | IP address of your resurrection engine server |
| `LOCAL_LLM_PORT` | Port (default `5000`) |

The workflow will:
1. Build the firmware with PlatformIO.
2. Upload `firmware.bin`, `bootloader.bin`, and `partitions.bin` as a workflow
   artefact.
3. On a **GitHub Release**, automatically attach the binaries to the release
   so they can be downloaded and flashed directly.

---

## Usage

1. Power the board and choose a firmware side from the startup menu:
   - **Bruce Firmware** (stable launch side)
   - **Resurrected AI** (spirit board side)
2. In **Resurrected AI** mode, rotate to select entries.
3. Select **Switch firmware side...** at the top of the list any time to return to side selection.
4. Select a question and press to send it to the local AI.
5. Press once more from the response screen to return to the question list.

---

## Project structure

```
resurrected-AI/
├── .github/
│   └── workflows/
│       └── build.yml          # CI — builds firmware & uploads artefact
├── backend/
│   ├── resurrection_engine.py # Local LLM Flask server with ResurrectionState
│   └── requirements.txt       # Python dependencies
├── firmware/
│   ├── platformio.ini         # PlatformIO project (ESP32-S3 target)
│   ├── src/
│   │   ├── main.cpp           # Firmware source
│   │   └── config.h.example   # Copy → config.h and fill in secrets
│   └── .gitignore
├── .gitignore
└── README.md
```

---

## Licence

MIT — do what you like with it. Don't summon anything you can't put back.
