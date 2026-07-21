export type DeviceFamily = 'esp32s3' | 'esp32' | 'flipper'

export interface FirmwareAssets {
  firmware: string        // release asset filename for the main firmware binary
  bootloader?: string     // optional bootloader binary filename
  partitions?: string     // optional partitions binary filename
}

export interface CatalogEntry {
  id: string
  name: string
  repo: string             // GitHub repo slug (owner/repo)
  description: string
  deviceFamily: DeviceFamily
  hardware: string         // human-readable hardware label
  assets: FirmwareAssets
  color: string            // tailwind accent colour class
}

const OWNER = 'Crashkeyz'

export const FIRMWARE_CATALOG: CatalogEntry[] = [
  {
    id: 'resurrected-ai',
    name: 'Resurrected AI — Spirit Board',
    repo: `${OWNER}/resurrected-AI`,
    description:
      'AI-powered spirit board for the LilyGo T-Embed Plus. Ask the spirit questions, watch cryptic answers appear on the display.',
    deviceFamily: 'esp32s3',
    hardware: 'LilyGo T-Embed Plus (ESP32-S3)',
    assets: {
      firmware: 'firmware.bin',
      bootloader: 'bootloader.bin',
      partitions: 'partitions.bin',
    },
    color: 'purple',
  },
  {
    id: 'ultimatum-cardputer',
    name: 'Ultimatum CardputerKey',
    repo: `${OWNER}/UltimatumCardputerKey`,
    description:
      'Advanced multi-tool firmware for the M5Stack Cardputer (ESP32-S3). Keyboard-driven Swiss Army knife for RF, NFC, and more.',
    deviceFamily: 'esp32s3',
    hardware: 'M5Stack Cardputer (ESP32-S3)',
    assets: {
      firmware: 'firmware.bin',
      bootloader: 'bootloader.bin',
      partitions: 'partitions.bin',
    },
    color: 'yellow',
  },
  {
    id: 'ultimatel-ily',
    name: 'Ultimate LilyGo',
    repo: `${OWNER}/ultimatel-ily`,
    description:
      'Ultimate multi-tool firmware for LilyGo devices. Combines RF, display, and sensor features into one unified firmware.',
    deviceFamily: 'esp32s3',
    hardware: 'LilyGo (ESP32-S3)',
    assets: {
      firmware: 'firmware.bin',
      bootloader: 'bootloader.bin',
      partitions: 'partitions.bin',
    },
    color: 'cyan',
  },
  {
    id: 'skeleton-key',
    name: 'Skeleton Key',
    repo: `${OWNER}/Skeleton-key-`,
    description:
      'ESP32-based all-purpose security research firmware. RF replay, NFC emulation, BadUSB, and more.',
    deviceFamily: 'esp32',
    hardware: 'ESP32 Dev Board',
    assets: {
      firmware: 'firmware.bin',
      bootloader: 'bootloader.bin',
      partitions: 'partitions.bin',
    },
    color: 'red',
  },
  {
    id: 'what-me',
    name: 'What-me (Skeletor)',
    repo: `${OWNER}/What-me`,
    description:
      'Skeletor-themed ESP32 firmware project. Fun, experimental, and unexpectedly powerful.',
    deviceFamily: 'esp32',
    hardware: 'ESP32 Dev Board',
    assets: {
      firmware: 'firmware.bin',
    },
    color: 'orange',
  },
]
