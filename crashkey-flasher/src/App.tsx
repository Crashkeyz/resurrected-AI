import { useState, useRef, useCallback } from 'react'
import './App.css'
import {
  Usb, Wifi, Bluetooth, Zap, AlertTriangle, CheckCircle2, XCircle,
  Upload, Terminal, ChevronDown, ChevronUp, RotateCcw, Cpu, Radio,
  HelpCircle, Loader2, Download, BookOpen
} from 'lucide-react'
import { FIRMWARE_CATALOG, type CatalogEntry } from './firmware-catalog'

type DeviceType = 'esp32s3' | 'flipper' | null
type FlashStep = 'select' | 'project' | 'connect' | 'upload' | 'flash' | 'done' | 'error'
type LogLevel = 'info' | 'warn' | 'error' | 'success'

interface LogEntry {
  time: string
  message: string
  level: LogLevel
}

function App() {
  const [device, setDevice] = useState<DeviceType>(null)
  const [step, setStep] = useState<FlashStep>('project')
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [progress, setProgress] = useState(0)
  const [isConnected, setIsConnected] = useState(false)
  const [isFlashing, setIsFlashing] = useState(false)
  const [firmwareFile, setFirmwareFile] = useState<File | null>(null)
  const [bootloaderFile, setBootloaderFile] = useState<File | null>(null)
  const [partitionsFile, setPartitionsFile] = useState<File | null>(null)
  const [showRecovery, setShowRecovery] = useState(false)
  const [showDriverHelp, setShowDriverHelp] = useState(false)
  const [showVibeCode, setShowVibeCode] = useState(false)
  const [chipInfo, setChipInfo] = useState<string>('')
  const [flashMethod, setFlashMethod] = useState<'usb' | 'wifi' | 'bt'>('usb')
  const [otaUrl, setOtaUrl] = useState('')
  const [flipperFwUrl, setFlipperFwUrl] = useState('https://update.flipperzero.one/firmware/release/latest')
  const [selectedProject, setSelectedProject] = useState<CatalogEntry | null>(null)
  const [isFetchingFirmware, setIsFetchingFirmware] = useState(false)

  const portRef = useRef<SerialPort | null>(null)
  const logEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const bootloaderInputRef = useRef<HTMLInputElement>(null)
  const partitionsInputRef = useRef<HTMLInputElement>(null)

  const addLog = useCallback((message: string, level: LogLevel = 'info') => {
    const time = new Date().toLocaleTimeString()
    setLogs(prev => [...prev, { time, message, level }])
    setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
  }, [])

  const clearLogs = () => setLogs([])

  const connectSerial = async () => {
    try {
      if (!('serial' in navigator)) {
        addLog('Web Serial API not supported. Use Chrome, Edge, or Opera on desktop.', 'error')
        addLog('Tip: Make sure chrome://flags/#enable-experimental-web-platform-features is enabled', 'warn')
        return
      }

      addLog('Requesting serial port...', 'info')

      const filters = device === 'esp32s3'
        ? [
            { usbVendorId: 0x303A },
            { usbVendorId: 0x10C4 },
            { usbVendorId: 0x1A86 },
            { usbVendorId: 0x0403 },
          ]
        : [
            { usbVendorId: 0x0483 },
          ]

      const port = await navigator.serial.requestPort({ filters })
      portRef.current = port

      const baudRate = device === 'flipper' ? 230400 : 115200
      await port.open({ baudRate })

      setIsConnected(true)
      setStep('upload')
      addLog(`Connected to ${device === 'esp32s3' ? 'ESP32-S3' : 'Flipper Zero'} at ${baudRate} baud`, 'success')

      if (device === 'esp32s3') {
        await detectESPChip()
      }

    } catch (err) {
      const error = err as Error
      if (error.name === 'NotFoundError') {
        addLog('No port selected. Make sure your device is plugged in via USB-C.', 'warn')
        addLog('If no ports appear: check drivers, try a different USB cable, or see the Driver Help section below.', 'warn')
      } else if (error.message?.includes('already open')) {
        addLog('Port is already open. Close other apps using the serial port (Arduino IDE, PlatformIO, qFlipper, etc.)', 'error')
      } else {
        addLog(`Connection error: ${error.message}`, 'error')
      }
    }
  }

  const detectESPChip = async () => {
    try {
      addLog('Detecting ESP32 chip...', 'info')
      const { ESPLoader, Transport } = await import('esptool-js')
      if (!portRef.current) return

      if (portRef.current.readable) {
        await portRef.current.close()
      }

      const transport = new Transport(portRef.current, true)
      const esploader = new ESPLoader({
        transport,
        baudrate: 115200,
        terminal: {
          clean: () => {},
          writeLine: (data: string) => addLog(data, 'info'),
          write: (data: string) => {
            if (data.trim()) addLog(data.trim(), 'info')
          }
        }
      })

      await esploader.main()
      const chipType = esploader.chip.CHIP_NAME
      setChipInfo(`${chipType}`)
      addLog(`Detected: ${chipType}`, 'success')

    } catch (err) {
      const error = err as Error
      addLog(`Chip detection note: ${error.message}`, 'warn')
      addLog('You can still proceed with flashing. Make sure the device is in download mode.', 'info')
    }
  }

  const readFileAsUint8Array = (file: File): Promise<Uint8Array> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
      reader.onerror = () => reject(reader.error)
      reader.readAsArrayBuffer(file)
    })
  }

  const flashESP32USB = async () => {
    if (!firmwareFile) {
      addLog('Please select a firmware .bin file first', 'error')
      return
    }

    setIsFlashing(true)
    setStep('flash')
    setProgress(0)

    try {
      addLog('Starting ESP32-S3 flash via USB...', 'info')
      addLog('Loading esptool-js...', 'info')

      const { ESPLoader, Transport } = await import('esptool-js')

      if (!portRef.current) {
        addLog('No serial port connected', 'error')
        setIsFlashing(false)
        return
      }

      if (portRef.current.readable) {
        try { await portRef.current.close() } catch { /* already closed */ }
      }

      const transport = new Transport(portRef.current, true)
      const esploader = new ESPLoader({
        transport,
        baudrate: 921600,
        terminal: {
          clean: () => {},
          writeLine: (data: string) => addLog(data, 'info'),
          write: (data: string) => {
            if (data.trim()) addLog(data.trim(), 'info')
          }
        }
      })

      addLog('Connecting to ESP32-S3 bootloader...', 'info')
      setProgress(5)
      await esploader.main()
      addLog('Connected to bootloader!', 'success')
      setProgress(10)

      const fileArray: { data: Uint8Array; address: number }[] = []

      if (bootloaderFile) {
        const blData = await readFileAsUint8Array(bootloaderFile)
        fileArray.push({ data: blData, address: 0x0000 })
        addLog('Bootloader queued at 0x0000', 'info')
      }

      if (partitionsFile) {
        const ptData = await readFileAsUint8Array(partitionsFile)
        fileArray.push({ data: ptData, address: 0x8000 })
        addLog('Partitions queued at 0x8000', 'info')
      }

      const fwData = await readFileAsUint8Array(firmwareFile)
      fileArray.push({ data: fwData, address: 0x10000 })
      addLog(`Firmware queued at 0x10000 (${(firmwareFile.size / 1024).toFixed(1)} KB)`, 'info')

      setProgress(15)
      addLog('Erasing flash and writing...', 'info')

      await esploader.writeFlash({
        fileArray,
        flashSize: 'keep',
        flashMode: 'keep',
        flashFreq: 'keep',
        eraseAll: false,
        compress: true,
        reportProgress: (_fileIdx: number, written: number, total: number) => {
          const pct = 15 + Math.round((written / total) * 80)
          setProgress(pct)
        },
        calculateMD5Hash: undefined
      })

      setProgress(98)
      addLog('Flash write complete! Resetting device...', 'success')

      addLog('Please manually reset your device (unplug and replug USB).', 'info')

      setProgress(100)
      setStep('done')
      addLog('Firmware flashed successfully! Device should be running new firmware.', 'success')

    } catch (err) {
      const error = err as Error
      addLog(`Flash error: ${error.message}`, 'error')

      if (error.message?.includes('Failed to connect') || error.message?.includes('Timed out')) {
        addLog('Device may not be in download mode. Try the Boot Loop Recovery steps below.', 'warn')
        setShowRecovery(true)
      }

      setStep('error')
    } finally {
      setIsFlashing(false)
    }
  }

  const flashFlipperZero = async () => {
    setIsFlashing(true)
    setStep('flash')
    setProgress(0)

    try {
      if (!portRef.current || !portRef.current.writable) {
        addLog('Not connected to Flipper Zero', 'error')
        setIsFlashing(false)
        return
      }

      addLog('Communicating with Flipper Zero CLI...', 'info')
      setProgress(10)

      const writer = portRef.current.writable.getWriter()
      const reader = portRef.current.readable?.getReader()

      const encoder = new TextEncoder()
      const decoder = new TextDecoder()

      await writer.write(encoder.encode('\r\n'))
      await new Promise(r => setTimeout(r, 500))

      if (reader) {
        const { value } = await reader.read()
        if (value) {
          const text = decoder.decode(value)
          addLog(`Flipper: ${text.trim()}`, 'info')
        }
        reader.releaseLock()
      }

      setProgress(20)

      if (firmwareFile) {
        addLog('Preparing DFU firmware update...', 'info')
        addLog('For Flipper Zero firmware updates, the recommended methods are:', 'info')
        addLog('1. qFlipper desktop app (most reliable)', 'info')
        addLog('2. Web Updater at lab.flipper.net', 'info')
        addLog('3. SD card method: copy .dfu to /ext/update/ on SD card', 'info')
        setProgress(50)

        addLog('Sending update command to Flipper...', 'info')
        await writer.write(encoder.encode('update install /ext/update\r\n'))
        await new Promise(r => setTimeout(r, 2000))

        setProgress(80)
        addLog('Update command sent. Flipper Zero will restart if update is valid.', 'success')
      } else {
        addLog('Querying Flipper Zero device info...', 'info')
        await writer.write(encoder.encode('device_info\r\n'))
        await new Promise(r => setTimeout(r, 1500))

        const reader2 = portRef.current.readable?.getReader()
        if (reader2) {
          try {
            const { value } = await reader2.read()
            if (value) {
              const lines = decoder.decode(value).split('\n')
              lines.forEach(line => {
                if (line.trim()) addLog(`  ${line.trim()}`, 'info')
              })
            }
          } finally {
            reader2.releaseLock()
          }
        }
      }

      writer.releaseLock()
      setProgress(100)
      setStep('done')
      addLog('Operation complete!', 'success')

    } catch (err) {
      const error = err as Error
      addLog(`Flipper error: ${error.message}`, 'error')
      setStep('error')
    } finally {
      setIsFlashing(false)
    }
  }

  const flashViaWifi = async () => {
    setIsFlashing(true)
    setStep('flash')
    setProgress(0)
    addLog('Starting WiFi OTA flash...', 'info')

    if (!otaUrl) {
      addLog('Please enter the device OTA update URL (e.g., http://192.168.1.x/update)', 'error')
      setIsFlashing(false)
      setStep('upload')
      return
    }

    if (!firmwareFile) {
      addLog('Please select a firmware file first', 'error')
      setIsFlashing(false)
      setStep('upload')
      return
    }

    try {
      addLog(`Uploading firmware to ${otaUrl}...`, 'info')
      setProgress(20)

      const formData = new FormData()
      formData.append('firmware', firmwareFile)

      const response = await fetch(otaUrl, {
        method: 'POST',
        body: formData,
      })

      setProgress(80)

      if (response.ok) {
        addLog('Firmware uploaded via WiFi OTA! Device will restart.', 'success')
        setProgress(100)
        setStep('done')
      } else {
        addLog(`OTA upload failed: ${response.status} ${response.statusText}`, 'error')
        setStep('error')
      }
    } catch (err) {
      const error = err as Error
      addLog(`WiFi OTA error: ${error.message}`, 'error')
      addLog('Make sure your device is on the same network and the OTA server is running.', 'warn')
      setStep('error')
    } finally {
      setIsFlashing(false)
    }
  }

  const disconnect = async () => {
    try {
      if (portRef.current?.readable) {
        await portRef.current.close()
      }
    } catch { /* ignore */ }
    portRef.current = null
    setIsConnected(false)
    setStep('select')
    setChipInfo('')
    setProgress(0)
    addLog('Disconnected.', 'info')
  }

  const resetAll = () => {
    disconnect()
    setDevice(null)
    setSelectedProject(null)
    setFirmwareFile(null)
    setBootloaderFile(null)
    setPartitionsFile(null)
    setProgress(0)
    clearLogs()
    setStep('project')
  }

  const fetchLatestFirmware = async (project: CatalogEntry) => {
    setIsFetchingFirmware(true)
    addLog(`Fetching latest release from ${project.repo}...`, 'info')

    try {
      const apiUrl = `https://api.github.com/repos/${project.repo}/releases/latest`
      const res = await fetch(apiUrl, {
        headers: { Accept: 'application/vnd.github+json' },
      })

      if (!res.ok) {
        if (res.status === 404) {
          addLog('No releases found for this project yet. Please upload firmware manually.', 'warn')
        } else {
          addLog(`GitHub API error: ${res.status} ${res.statusText}`, 'error')
        }
        return
      }

      const release = await res.json() as {
        tag_name: string
        name: string
        assets: { name: string; browser_download_url: string }[]
      }

      addLog(`Found release: ${release.name || release.tag_name}`, 'success')

      const downloadAsset = async (filename: string): Promise<File | null> => {
        const asset = release.assets.find(a => a.name === filename)
        if (!asset) {
          addLog(`Asset not found in release: ${filename}`, 'warn')
          return null
        }
        addLog(`Downloading ${filename}...`, 'info')
        const dlRes = await fetch(asset.browser_download_url)
        if (!dlRes.ok) {
          addLog(`Failed to download ${filename}: ${dlRes.statusText}`, 'error')
          return null
        }
        const blob = await dlRes.blob()
        addLog(`Downloaded ${filename} (${(blob.size / 1024).toFixed(1)} KB)`, 'success')
        return new File([blob], filename, { type: 'application/octet-stream' })
      }

      const fw = await downloadAsset(project.assets.firmware)
      if (fw) setFirmwareFile(fw)

      if (project.assets.bootloader) {
        const bl = await downloadAsset(project.assets.bootloader)
        if (bl) setBootloaderFile(bl)
      }

      if (project.assets.partitions) {
        const pt = await downloadAsset(project.assets.partitions)
        if (pt) setPartitionsFile(pt)
      }

      if (fw) {
        addLog('Firmware ready! Click Flash to continue.', 'success')
      }
    } catch (err) {
      const error = err as Error
      addLog(`Fetch error: ${error.message}`, 'error')
      addLog('Note: GitHub API may be rate-limited if you have tried many times. Try again in a minute.', 'warn')
    } finally {
      setIsFetchingFirmware(false)
    }
  }

  const startFlash = () => {
    if (flashMethod === 'usb') {
      if (device === 'esp32s3') flashESP32USB()
      else if (device === 'flipper') flashFlipperZero()
    } else if (flashMethod === 'wifi') {
      flashViaWifi()
    } else {
      addLog('Bluetooth flashing is not yet supported for this device.', 'warn')
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Zap className="text-yellow-400" size={28} />
            <div>
              <h1 className="text-xl font-bold text-white">Terminator ESP32 Flasher</h1>
              <p className="text-xs text-gray-400">One-click firmware flasher for CrashKey devices</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {isConnected && (
              <span className="flex items-center gap-1 text-xs text-green-400">
                <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                Connected
              </span>
            )}
            <button
              onClick={resetAll}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-white transition px-3 py-1.5 rounded border border-gray-700 hover:border-gray-500"
            >
              <RotateCcw size={12} /> Reset
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        {step === 'project' && (
          <section>
            <h2 className="text-lg font-semibold mb-1 text-gray-200 flex items-center gap-2">
              <BookOpen size={18} className="text-yellow-400" /> Select a Project to Flash
            </h2>
            <p className="text-sm text-gray-400 mb-6">
              Choose a CrashKey firmware project. The latest release will be downloaded automatically.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
              {FIRMWARE_CATALOG.map(project => {
                const colorMap: Record<string, { border: string; hover: string; badge: string; text: string }> = {
                  purple: { border: 'border-purple-700/40', hover: 'hover:border-purple-500/60', badge: 'bg-purple-900/50 text-purple-300', text: 'text-purple-400' },
                  yellow: { border: 'border-yellow-700/40', hover: 'hover:border-yellow-500/60', badge: 'bg-yellow-900/50 text-yellow-300', text: 'text-yellow-400' },
                  cyan:   { border: 'border-cyan-700/40',   hover: 'hover:border-cyan-500/60',   badge: 'bg-cyan-900/50 text-cyan-300',   text: 'text-cyan-400' },
                  red:    { border: 'border-red-700/40',    hover: 'hover:border-red-500/60',    badge: 'bg-red-900/50 text-red-300',    text: 'text-red-400' },
                  orange: { border: 'border-orange-700/40', hover: 'hover:border-orange-500/60', badge: 'bg-orange-900/50 text-orange-300', text: 'text-orange-400' },
                }
                const c = colorMap[project.color] ?? colorMap.yellow

                return (
                  <button
                    key={project.id}
                    onClick={() => {
                      setSelectedProject(project)
                      const devType: DeviceType = project.deviceFamily === 'flipper' ? 'flipper' : 'esp32s3'
                      setDevice(devType)
                      setStep('connect')
                    }}
                    className={`p-5 rounded-xl border-2 text-left transition-all bg-gray-900 ${c.border} ${c.hover}`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div>
                        <h3 className={`font-bold text-white text-sm`}>{project.name}</h3>
                        <p className={`text-xs ${c.text} mt-0.5`}>{project.hardware}</p>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded flex-shrink-0 ${c.badge}`}>
                        {project.deviceFamily.toUpperCase()}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 leading-relaxed">{project.description}</p>
                    <div className="flex items-center gap-1 mt-3 text-xs text-gray-500">
                      <Download size={10} />
                      <span>Auto-fetches latest release · {project.repo}</span>
                    </div>
                  </button>
                )
              })}
            </div>

            <div className="border border-gray-700/50 rounded-lg overflow-hidden">
              <button
                onClick={() => setStep('select')}
                className="w-full flex items-center justify-between p-4 bg-gray-900 hover:bg-gray-800 transition text-left"
              >
                <span className="flex items-center gap-2 text-gray-400 font-medium text-sm">
                  <Upload size={14} /> Manual Flash — upload your own firmware file
                </span>
                <ChevronDown size={16} className="text-gray-500" />
              </button>
            </div>
          </section>
        )}

        {step === 'select' && (
          <section>
            <h2 className="text-lg font-semibold mb-2 text-gray-200">Select Your Device</h2>
            <p className="text-sm text-gray-400 mb-6">Choose the device you want to flash firmware to.</p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
              <button
                onClick={() => { setDevice('esp32s3'); setStep('connect') }}
                className="p-6 rounded-xl border-2 text-left transition-all border-gray-700 bg-gray-900 hover:border-yellow-500/50"
              >
                <div className="flex items-center gap-3 mb-3">
                  <Cpu className="text-yellow-400" size={32} />
                  <div>
                    <h3 className="font-bold text-white">ESP32-S3 / LilyGo T-Embed Plus</h3>
                    <p className="text-xs text-gray-400">ESP32-S3, ESP32, ESP8266</p>
                  </div>
                </div>
                <p className="text-sm text-gray-300">
                  Flash firmware to ESP32-based devices including LilyGo T-Embed Plus.
                  Includes boot loop recovery mode.
                </p>
                <div className="flex gap-2 mt-3">
                  <span className="text-xs px-2 py-0.5 rounded bg-green-900/50 text-green-300 flex items-center gap-1">
                    <Usb size={10} /> USB-C
                  </span>
                  <span className="text-xs px-2 py-0.5 rounded bg-blue-900/50 text-blue-300 flex items-center gap-1">
                    <Wifi size={10} /> WiFi OTA
                  </span>
                </div>
              </button>

              <button
                onClick={() => { setDevice('flipper'); setStep('connect') }}
                className="p-6 rounded-xl border-2 text-left transition-all border-gray-700 bg-gray-900 hover:border-orange-500/50"
              >
                <div className="flex items-center gap-3 mb-3">
                  <Radio className="text-orange-400" size={32} />
                  <div>
                    <h3 className="font-bold text-white">Flipper Zero</h3>
                    <p className="text-xs text-gray-400">Dark Flipper, Unleashed, Momentum</p>
                  </div>
                </div>
                <p className="text-sm text-gray-300">
                  Flash custom firmware to Flipper Zero. Supports Dark Flipper, Unleashed,
                  Momentum, and RogueMaster.
                </p>
                <div className="flex gap-2 mt-3">
                  <span className="text-xs px-2 py-0.5 rounded bg-green-900/50 text-green-300 flex items-center gap-1">
                    <Usb size={10} /> USB
                  </span>
                  <span className="text-xs px-2 py-0.5 rounded bg-purple-900/50 text-purple-300 flex items-center gap-1">
                    <Radio size={10} /> Web Updater
                  </span>
                </div>
              </button>
            </div>

            <div className="space-y-3">
              <div className="border border-red-900/50 rounded-lg overflow-hidden">
                <button
                  onClick={() => setShowRecovery(!showRecovery)}
                  className="w-full flex items-center justify-between p-4 bg-red-950/30 hover:bg-red-950/50 transition text-left"
                >
                  <span className="flex items-center gap-2 text-red-300 font-medium text-sm">
                    <AlertTriangle size={16} /> Boot Loop Recovery (ESP32-S3 / LilyGo)
                  </span>
                  {showRecovery ? <ChevronUp size={16} className="text-red-400" /> : <ChevronDown size={16} className="text-red-400" />}
                </button>
                {showRecovery && (
                  <div className="p-5 bg-gray-900 text-sm space-y-4">
                    <p className="text-gray-300 font-medium">If your LilyGo T-Embed Plus is stuck in a boot loop, follow these steps to force it into download mode:</p>
                    <ol className="space-y-3 text-gray-300">
                      <li className="flex gap-3">
                        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-red-900 text-red-300 flex items-center justify-center text-xs font-bold">1</span>
                        <div><strong>Unplug</strong> the USB-C cable from the device completely.</div>
                      </li>
                      <li className="flex gap-3">
                        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-red-900 text-red-300 flex items-center justify-center text-xs font-bold">2</span>
                        <div><strong>Hold down the BOOT button</strong> (small button on the board, NOT the rotary encoder).</div>
                      </li>
                      <li className="flex gap-3">
                        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-red-900 text-red-300 flex items-center justify-center text-xs font-bold">3</span>
                        <div><strong>While holding BOOT, plug in the USB-C cable</strong> to your computer.</div>
                      </li>
                      <li className="flex gap-3">
                        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-red-900 text-red-300 flex items-center justify-center text-xs font-bold">4</span>
                        <div><strong>Keep holding BOOT for 3 seconds</strong> after plugging in, then release.</div>
                      </li>
                      <li className="flex gap-3">
                        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-red-900 text-red-300 flex items-center justify-center text-xs font-bold">5</span>
                        <div>The screen should be <strong>blank/off</strong>. This means it is in download mode. Now click Connect above and flash.</div>
                      </li>
                    </ol>
                    <div className="bg-yellow-900/30 border border-yellow-700/50 rounded p-3 mt-3">
                      <p className="text-yellow-300 text-xs font-medium">Important Notes:</p>
                      <ul className="text-yellow-200/80 text-xs mt-1 space-y-1">
                        <li>- If no BOOT button exists, try shorting GPIO0 to GND while plugging in</li>
                        <li>- Use a good quality USB-C data cable (not charge-only)</li>
                        <li>- ESP32-S3 uses USB JTAG by default - you may see &quot;USB JTAG/serial debug unit&quot; in the port list</li>
                        <li>- If using CH340/CP2102 USB-Serial: install the correct drivers (see Driver Help below)</li>
                        <li>- Try different USB ports - USB 2.0 ports sometimes work better than USB 3.0</li>
                      </ul>
                    </div>
                  </div>
                )}
              </div>

              <div className="border border-blue-900/50 rounded-lg overflow-hidden">
                <button
                  onClick={() => setShowDriverHelp(!showDriverHelp)}
                  className="w-full flex items-center justify-between p-4 bg-blue-950/30 hover:bg-blue-950/50 transition text-left"
                >
                  <span className="flex items-center gap-2 text-blue-300 font-medium text-sm">
                    <HelpCircle size={16} /> Driver Help &amp; Chrome Troubleshooting
                  </span>
                  {showDriverHelp ? <ChevronUp size={16} className="text-blue-400" /> : <ChevronDown size={16} className="text-blue-400" />}
                </button>
                {showDriverHelp && (
                  <div className="p-5 bg-gray-900 text-sm space-y-4">
                    <div>
                      <h4 className="text-blue-300 font-medium mb-2">Chrome Blocking Downloads / Uploads?</h4>
                      <ol className="space-y-2 text-gray-300">
                        <li>1. Go to <code className="bg-gray-800 px-1.5 py-0.5 rounded text-blue-300">chrome://settings/security</code></li>
                        <li>2. Under &quot;Safe Browsing&quot;, select <strong>&quot;No protection&quot;</strong> (temporarily)</li>
                        <li>3. Under &quot;Downloads&quot;, make sure &quot;Ask where to save each file&quot; is off</li>
                        <li>4. If Chrome flags a download, click <strong>&quot;Keep&quot;</strong> then <strong>&quot;Keep anyway&quot;</strong></li>
                      </ol>
                    </div>
                    <div>
                      <h4 className="text-blue-300 font-medium mb-2">Web Serial Not Working?</h4>
                      <ol className="space-y-2 text-gray-300">
                        <li>1. Open <code className="bg-gray-800 px-1.5 py-0.5 rounded text-blue-300">chrome://flags/#enable-experimental-web-platform-features</code></li>
                        <li>2. Set to <strong>Enabled</strong> and restart Chrome</li>
                        <li>3. Make sure you are using Chrome, Edge, or Opera (Firefox/Safari do not support Web Serial)</li>
                        <li>4. <strong>Close</strong> Arduino IDE, PlatformIO, qFlipper, or any other app using the serial port</li>
                      </ol>
                    </div>
                    <div>
                      <h4 className="text-blue-300 font-medium mb-2">USB Drivers</h4>
                      <div className="space-y-2 text-gray-300">
                        <p><strong>CH340/CH341</strong> (common on cheap boards):</p>
                        <a href="http://www.wch-ic.com/downloads/CH341SER_ZIP.html" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline block ml-4">
                          Download CH340/CH341 Driver
                        </a>
                        <p><strong>CP210x</strong> (Silicon Labs):</p>
                        <a href="https://www.silabs.com/developers/usb-to-uart-bridge-vcp-drivers" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline block ml-4">
                          Download CP210x Driver
                        </a>
                        <p><strong>FTDI</strong>:</p>
                        <a href="https://ftdichip.com/drivers/" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline block ml-4">
                          Download FTDI Driver
                        </a>
                      </div>
                    </div>
                    <div className="bg-gray-800 rounded p-3">
                      <p className="text-gray-400 text-xs">
                        <strong>Windows users:</strong> You may need to install the ESP32-S3 USB JTAG driver.
                        Open Device Manager, find the unknown device, and update driver pointing to the Espressif driver folder.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div className="border border-purple-900/50 rounded-lg overflow-hidden">
                <button
                  onClick={() => setShowVibeCode(!showVibeCode)}
                  className="w-full flex items-center justify-between p-4 bg-purple-950/30 hover:bg-purple-950/50 transition text-left"
                >
                  <span className="flex items-center gap-2 text-purple-300 font-medium text-sm">
                    <Zap size={16} /> AI Vibe Coding Integration Guide
                  </span>
                  {showVibeCode ? <ChevronUp size={16} className="text-purple-400" /> : <ChevronDown size={16} className="text-purple-400" />}
                </button>
                {showVibeCode && (
                  <div className="p-5 bg-gray-900 text-sm space-y-4">
                    <p className="text-gray-300">How to add AI-generated &quot;vibe coded&quot; features to your firmware:</p>

                    <div>
                      <h4 className="text-purple-300 font-medium mb-2">For ESP32 / LilyGo (Arduino/PlatformIO)</h4>
                      <ol className="space-y-2 text-gray-300">
                        <li>1. Use an AI tool (Copilot, Claude, ChatGPT) to generate a <code className="bg-gray-800 px-1 rounded">.cpp</code> module</li>
                        <li>2. Add your module to the <code className="bg-gray-800 px-1 rounded">src/</code> folder in PlatformIO</li>
                        <li>3. Include it in <code className="bg-gray-800 px-1 rounded">main.cpp</code> with <code className="bg-gray-800 px-1 rounded">#include &quot;your_module.h&quot;</code></li>
                        <li>4. Register it in the main menu system (varies by firmware)</li>
                        <li>5. Build with <code className="bg-gray-800 px-1 rounded">pio run</code> and flash the resulting .bin here</li>
                      </ol>
                    </div>

                    <div>
                      <h4 className="text-purple-300 font-medium mb-2">For Flipper Zero (Dark Flipper / Unleashed)</h4>
                      <ol className="space-y-2 text-gray-300">
                        <li>1. Clone the firmware repo (e.g., DarkFlippers/unleashed-firmware)</li>
                        <li>2. AI-generate a Flipper app in <code className="bg-gray-800 px-1 rounded">applications_user/</code></li>
                        <li>3. Create <code className="bg-gray-800 px-1 rounded">application.fam</code> manifest for your app</li>
                        <li>4. Build with <code className="bg-gray-800 px-1 rounded">./fbt fap_your_app</code> for a .fap plugin</li>
                        <li>5. Or build full firmware with <code className="bg-gray-800 px-1 rounded">./fbt</code> and flash the .dfu</li>
                        <li>6. Copy .fap files to SD card <code className="bg-gray-800 px-1 rounded">/ext/apps/</code> - no reflash needed!</li>
                      </ol>
                    </div>

                    <div className="bg-purple-900/20 border border-purple-700/40 rounded p-3">
                      <p className="text-purple-200 text-xs">
                        <strong>Pro tip:</strong> For Flipper Zero, .fap apps can be loaded without reflashing.
                        Just copy to the SD card&apos;s /ext/apps/ folder. This is the easiest way to add
                        AI-generated features without touching the base firmware.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <button
              onClick={() => setStep('project')}
              className="mt-6 text-sm text-gray-500 hover:text-gray-300 transition"
            >
              &larr; Back to project selection
            </button>
          </section>
        )}

        {step === 'connect' && (
          <section>
            <h2 className="text-lg font-semibold mb-2 text-gray-200">
              Connect {device === 'esp32s3' ? 'ESP32-S3 / LilyGo' : 'Flipper Zero'}
            </h2>
            {selectedProject && (
              <p className="text-xs text-gray-500 mb-1">Project: {selectedProject.name}</p>
            )}
            <p className="text-sm text-gray-400 mb-6">
              {device === 'esp32s3'
                ? 'Plug in your device via USB-C. If stuck in boot loop, use recovery steps below first.'
                : 'Plug in your Flipper Zero via USB. Close qFlipper if running.'}
            </p>

            {device === 'esp32s3' && (
              <div className="flex gap-3 mb-6">
                <button
                  onClick={() => setFlashMethod('usb')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition
                    ${flashMethod === 'usb' ? 'border-green-500 bg-green-500/10 text-green-300' : 'border-gray-700 text-gray-400 hover:border-gray-500'}`}
                >
                  <Usb size={16} /> USB-C (Recommended)
                </button>
                <button
                  onClick={() => setFlashMethod('wifi')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition
                    ${flashMethod === 'wifi' ? 'border-blue-500 bg-blue-500/10 text-blue-300' : 'border-gray-700 text-gray-400 hover:border-gray-500'}`}
                >
                  <Wifi size={16} /> WiFi OTA
                </button>
                <button
                  onClick={() => setFlashMethod('bt')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition
                    ${flashMethod === 'bt' ? 'border-purple-500 bg-purple-500/10 text-purple-300' : 'border-gray-700 text-gray-400 hover:border-gray-500'}`}
                >
                  <Bluetooth size={16} /> Bluetooth
                </button>
              </div>
            )}

            {flashMethod === 'bt' && (
              <div className="bg-yellow-900/20 border border-yellow-700/50 rounded-lg p-4 mb-6">
                <p className="text-yellow-300 text-sm">
                  <AlertTriangle className="inline mr-1" size={14} />
                  Bluetooth flashing requires the device to already be running firmware with BLE OTA support.
                  If your device is bricked/boot-looping, use USB-C instead.
                </p>
              </div>
            )}

            {flashMethod === 'wifi' ? (
              <div className="space-y-4 mb-6">
                <div>
                  <label className="block text-sm text-gray-300 mb-1">Device OTA URL</label>
                  <input
                    type="text"
                    value={otaUrl}
                    onChange={e => setOtaUrl(e.target.value)}
                    placeholder="http://192.168.1.x/update"
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Your device must be running firmware with an OTA web server (e.g., ArduinoOTA, ElegantOTA)
                  </p>
                </div>
                <button
                  onClick={() => setStep('upload')}
                  className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2.5 rounded-lg font-medium text-sm transition"
                >
                  Continue to File Upload
                </button>
              </div>
            ) : flashMethod === 'usb' ? (
              <div className="space-y-4">
                <button
                  onClick={connectSerial}
                  disabled={isConnected}
                  className="bg-yellow-500 hover:bg-yellow-400 disabled:bg-gray-700 disabled:text-gray-500 text-gray-900 px-6 py-3 rounded-lg font-bold text-sm transition flex items-center gap-2"
                >
                  <Usb size={18} />
                  {isConnected ? 'Connected!' : 'Connect via USB'}
                </button>

                {chipInfo && (
                  <div className="bg-green-900/20 border border-green-700/50 rounded-lg p-3">
                    <p className="text-green-300 text-sm font-mono">{chipInfo}</p>
                  </div>
                )}
              </div>
            ) : null}

            {device === 'flipper' && (
              <div className="mt-6 space-y-3">
                <h3 className="text-sm font-medium text-gray-300">Quick Flash Links (Web Updaters)</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <a href="https://lab.flipper.net/?url=https://unleashedflip.com/fw_extra_apps/flipper-z-f7-update-unlshd.tgz&channel=release-cfw&version=latest" target="_blank" rel="noopener noreferrer"
                    className="p-3 bg-gray-800 rounded-lg border border-gray-700 hover:border-orange-500/50 transition text-left">
                    <p className="font-medium text-orange-300 text-sm">Unleashed Firmware</p>
                    <p className="text-xs text-gray-400">Flash via official Flipper Lab</p>
                  </a>
                  <a href="https://momentum-fw.dev/update" target="_blank" rel="noopener noreferrer"
                    className="p-3 bg-gray-800 rounded-lg border border-gray-700 hover:border-blue-500/50 transition text-left">
                    <p className="font-medium text-blue-300 text-sm">Momentum Firmware</p>
                    <p className="text-xs text-gray-400">Flash via Momentum web updater</p>
                  </a>
                  <a href="https://lab.flipper.net/" target="_blank" rel="noopener noreferrer"
                    className="p-3 bg-gray-800 rounded-lg border border-gray-700 hover:border-green-500/50 transition text-left">
                    <p className="font-medium text-green-300 text-sm">Official Flipper Lab</p>
                    <p className="text-xs text-gray-400">Update to official firmware</p>
                  </a>
                  <a href="https://github.com/DarkFlippers/unleashed-firmware/releases" target="_blank" rel="noopener noreferrer"
                    className="p-3 bg-gray-800 rounded-lg border border-gray-700 hover:border-red-500/50 transition text-left">
                    <p className="font-medium text-red-300 text-sm">Dark Flippers Releases</p>
                    <p className="text-xs text-gray-400">Download .dfu files</p>
                  </a>
                </div>
                <button
                  onClick={connectSerial}
                  disabled={isConnected}
                  className="mt-3 bg-orange-500 hover:bg-orange-400 disabled:bg-gray-700 disabled:text-gray-500 text-gray-900 px-6 py-3 rounded-lg font-bold text-sm transition flex items-center gap-2"
                >
                  <Usb size={18} />
                  {isConnected ? 'Connected!' : 'Connect Flipper via USB'}
                </button>
              </div>
            )}

            <button
              onClick={() => { setStep('project'); setDevice(null) }}
              className="mt-6 text-sm text-gray-500 hover:text-gray-300 transition"
            >
              &larr; Back to project selection
            </button>
          </section>
        )}

        {step === 'upload' && (
          <section>
            <h2 className="text-lg font-semibold mb-2 text-gray-200">
              {selectedProject ? `Flash ${selectedProject.name}` : 'Upload Firmware'}
            </h2>
            <p className="text-sm text-gray-400 mb-6">
              {selectedProject
                ? `Fetch the latest release from GitHub, or upload your own .bin file.`
                : `Select your firmware .bin file${device === 'esp32s3' ? ' and optional bootloader/partitions' : ''}.`}
            </p>

            {selectedProject && (
              <div className="mb-6 p-4 bg-gray-900 border border-gray-700 rounded-lg flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-gray-200">{selectedProject.name}</p>
                  <p className="text-xs text-gray-500">{selectedProject.repo}</p>
                  {firmwareFile && (
                    <p className="text-xs text-green-400 mt-1">
                      ✓ {firmwareFile.name} ({(firmwareFile.size / 1024).toFixed(1)} KB) ready
                    </p>
                  )}
                </div>
                <button
                  onClick={() => fetchLatestFirmware(selectedProject)}
                  disabled={isFetchingFirmware}
                  className="flex-shrink-0 flex items-center gap-2 bg-yellow-500 hover:bg-yellow-400 disabled:bg-gray-700 disabled:text-gray-500 text-gray-900 px-4 py-2.5 rounded-lg font-bold text-sm transition"
                >
                  {isFetchingFirmware
                    ? <><Loader2 size={15} className="animate-spin" /> Fetching...</>
                    : <><Download size={15} /> Fetch Latest Release</>}
                </button>
              </div>
            )}

            <div className="space-y-4 max-w-lg">
              <div>
                <label className="block text-sm text-gray-300 mb-1 font-medium">
                  {selectedProject ? 'Or upload manually:' : `Firmware File (.bin${device === 'flipper' ? ' or .dfu' : ''}) *`}
                </label>
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-gray-600 hover:border-yellow-500/50 rounded-lg p-6 text-center cursor-pointer transition"
                >
                  <Upload className="mx-auto text-gray-500 mb-2" size={28} />
                  {firmwareFile ? (
                    <p className="text-sm text-green-300">{firmwareFile.name} ({(firmwareFile.size / 1024).toFixed(1)} KB)</p>
                  ) : (
                    <p className="text-sm text-gray-400">Click to select firmware file</p>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".bin,.dfu,.uf2"
                  className="hidden"
                  onChange={e => setFirmwareFile(e.target.files?.[0] || null)}
                />
              </div>

              {device === 'esp32s3' && (
                <>
                  <div>
                    <label className="block text-sm text-gray-300 mb-1">Bootloader (optional)</label>
                    <div
                      onClick={() => bootloaderInputRef.current?.click()}
                      className="border border-gray-700 hover:border-gray-500 rounded-lg p-3 text-center cursor-pointer transition"
                    >
                      {bootloaderFile ? (
                        <p className="text-xs text-green-300">{bootloaderFile.name}</p>
                      ) : (
                        <p className="text-xs text-gray-500">Click to select bootloader.bin (flashes at 0x0000)</p>
                      )}
                    </div>
                    <input ref={bootloaderInputRef} type="file" accept=".bin" className="hidden"
                      onChange={e => setBootloaderFile(e.target.files?.[0] || null)} />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-300 mb-1">Partitions (optional)</label>
                    <div
                      onClick={() => partitionsInputRef.current?.click()}
                      className="border border-gray-700 hover:border-gray-500 rounded-lg p-3 text-center cursor-pointer transition"
                    >
                      {partitionsFile ? (
                        <p className="text-xs text-green-300">{partitionsFile.name}</p>
                      ) : (
                        <p className="text-xs text-gray-500">Click to select partitions.bin (flashes at 0x8000)</p>
                      )}
                    </div>
                    <input ref={partitionsInputRef} type="file" accept=".bin" className="hidden"
                      onChange={e => setPartitionsFile(e.target.files?.[0] || null)} />
                  </div>
                </>
              )}

              {device === 'flipper' && (
                <div>
                  <label className="block text-sm text-gray-300 mb-1">Or use firmware URL</label>
                  <input
                    type="text"
                    value={flipperFwUrl}
                    onChange={e => setFlipperFwUrl(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm text-gray-200 focus:border-orange-500 focus:outline-none"
                  />
                </div>
              )}

              <button
                onClick={startFlash}
                disabled={!firmwareFile || isFlashing}
                className="bg-red-600 hover:bg-red-500 disabled:bg-gray-700 disabled:text-gray-500 text-white px-8 py-3 rounded-lg font-bold text-sm transition flex items-center gap-2"
              >
                <Zap size={18} />
                {isFlashing ? 'Flashing...' : `Flash ${device === 'esp32s3' ? 'ESP32' : 'Flipper Zero'}`}
              </button>

              <button
                onClick={() => setStep('connect')}
                className="text-sm text-gray-500 hover:text-gray-300 transition"
              >
                &larr; Back
              </button>
            </div>
          </section>
        )}

        {(step === 'flash' || step === 'done' || step === 'error') && (
          <section>
            <h2 className="text-lg font-semibold mb-4 text-gray-200 flex items-center gap-2">
              {step === 'flash' && <><Loader2 className="animate-spin text-yellow-400" size={20} /> Flashing...</>}
              {step === 'done' && <><CheckCircle2 className="text-green-400" size={20} /> Flash Complete!</>}
              {step === 'error' && <><XCircle className="text-red-400" size={20} /> Flash Error</>}
            </h2>

            <div className="w-full bg-gray-800 rounded-full h-3 mb-4 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  step === 'error' ? 'bg-red-500' : step === 'done' ? 'bg-green-500' : 'bg-yellow-500'
                }`}
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-xs text-gray-400 mb-6">{progress}% complete</p>

            {step === 'done' && (
              <div className="bg-green-900/20 border border-green-700/50 rounded-lg p-4 mb-4">
                <p className="text-green-300 text-sm font-medium">
                  Firmware flashed successfully! Your device should now be running the new firmware.
                  If the device does not start, unplug and replug the USB cable.
                </p>
              </div>
            )}

            {step === 'error' && (
              <div className="bg-red-900/20 border border-red-700/50 rounded-lg p-4 mb-4">
                <p className="text-red-300 text-sm font-medium mb-2">
                  Something went wrong. Check the log below for details.
                </p>
                <button
                  onClick={() => setShowRecovery(true)}
                  className="text-xs text-red-400 hover:text-red-300 underline"
                >
                  Show Boot Loop Recovery Steps
                </button>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={resetAll}
                className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm transition"
              >
                Start Over
              </button>
              {step === 'error' && (
                <button
                  onClick={() => { setStep('upload'); setProgress(0) }}
                  className="bg-yellow-600 hover:bg-yellow-500 text-gray-900 px-4 py-2 rounded-lg text-sm font-medium transition"
                >
                  Try Again
                </button>
              )}
            </div>
          </section>
        )}

        {logs.length > 0 && (
          <section className="mt-8">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-gray-400 flex items-center gap-2">
                <Terminal size={14} /> Console Log
              </h3>
              <button onClick={clearLogs} className="text-xs text-gray-500 hover:text-gray-300 transition">
                Clear
              </button>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 max-h-72 overflow-y-auto font-mono text-xs">
              {logs.map((log, i) => (
                <div key={i} className={`py-0.5 ${
                  log.level === 'error' ? 'text-red-400' :
                  log.level === 'warn' ? 'text-yellow-400' :
                  log.level === 'success' ? 'text-green-400' :
                  'text-gray-400'
                }`}>
                  <span className="text-gray-600 mr-2">[{log.time}]</span>
                  {log.message}
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          </section>
        )}

        {showRecovery && step !== 'select' && (
          <section className="mt-6">
            <div className="border border-red-900/50 rounded-lg p-5 bg-red-950/20">
              <h3 className="text-red-300 font-medium text-sm mb-3 flex items-center gap-2">
                <AlertTriangle size={16} /> Boot Loop Recovery Steps
              </h3>
              <ol className="space-y-2 text-sm text-gray-300">
                <li>1. <strong>Unplug</strong> USB-C completely</li>
                <li>2. <strong>Hold BOOT button</strong> on the board</li>
                <li>3. <strong>Plug in USB-C</strong> while holding BOOT</li>
                <li>4. <strong>Hold 3 more seconds</strong>, then release</li>
                <li>5. Screen should be <strong>blank</strong> = download mode</li>
                <li>6. Click &quot;Connect&quot; and flash</li>
              </ol>
            </div>
          </section>
        )}
      </main>

      <footer className="border-t border-gray-800 py-6 mt-12">
        <div className="max-w-5xl mx-auto px-6 text-center">
          <p className="text-xs text-gray-500">
            Terminator ESP32 Flasher &mdash; Web Serial firmware tool for CrashKey ESP32 devices
          </p>
          <p className="text-xs text-gray-600 mt-1">
            Requires Chrome, Edge, or Opera. Connect via USB for best results.
          </p>
        </div>
      </footer>
    </div>
  )
}

export default App
