import { ESPLoader, Transport } from 'esptool-js'

type LogLevel = 'info' | 'warn' | 'error' | 'success'

type LogFn = (message: string, level?: LogLevel) => void

type ProgressFn = (value: number) => void

export interface ChipInfo {
  chipName: string
  macAddress: string
  flashId: string
  flashSize: string
}

export interface FlashFile {
  data: Uint8Array
  address: number
  name: string
}

export interface WriteFlashOptions {
  fileArray: FlashFile[]
  baudRate: number
  eraseAll: boolean
  compress: boolean
  flashSize?: 'keep' | 'detect'
  verify?: boolean
  reboot: boolean
  reportProgress?: ProgressFn
}

interface LoaderSession {
  transport: Transport
  loader: ESPLoader
}

const hex = (value: number) => `0x${value.toString(16).toUpperCase()}`

const leftRotate = (value: number, amount: number) => (value << amount) | (value >>> (32 - amount))

const md5Hex = (input: Uint8Array): string => {
  const messageLength = input.length
  const bitLength = messageLength * 8
  const paddedLength = (((messageLength + 8) >> 6) + 1) * 64
  const buffer = new Uint8Array(paddedLength)
  buffer.set(input)
  buffer[messageLength] = 0x80

  const bitLow = bitLength >>> 0
  const bitHigh = Math.floor(bitLength / 0x100000000) >>> 0
  const view = new DataView(buffer.buffer)
  view.setUint32(paddedLength - 8, bitLow, true)
  view.setUint32(paddedLength - 4, bitHigh, true)

  let a0 = 0x67452301
  let b0 = 0xefcdab89
  let c0 = 0x98badcfe
  let d0 = 0x10325476

  const shifts = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ]

  const table = new Array<number>(64).fill(0).map((_, index) => (
    Math.floor(Math.abs(Math.sin(index + 1)) * 0x100000000) >>> 0
  ))

  for (let offset = 0; offset < paddedLength; offset += 64) {
    const chunk = new Array<number>(16)
    for (let i = 0; i < 16; i += 1) {
      chunk[i] = view.getUint32(offset + i * 4, true)
    }

    let a = a0
    let b = b0
    let c = c0
    let d = d0

    for (let i = 0; i < 64; i += 1) {
      let f: number
      let g: number

      if (i < 16) {
        f = (b & c) | (~b & d)
        g = i
      } else if (i < 32) {
        f = (d & b) | (~d & c)
        g = (5 * i + 1) % 16
      } else if (i < 48) {
        f = b ^ c ^ d
        g = (3 * i + 5) % 16
      } else {
        f = c ^ (b | ~d)
        g = (7 * i) % 16
      }

      const temp = d
      d = c
      c = b
      const sum = (a + f + table[i] + chunk[g]) >>> 0
      b = (b + leftRotate(sum, shifts[i])) >>> 0
      a = temp
    }

    a0 = (a0 + a) >>> 0
    b0 = (b0 + b) >>> 0
    c0 = (c0 + c) >>> 0
    d0 = (d0 + d) >>> 0
  }

  const digest = new Uint8Array(16)
  const out = new DataView(digest.buffer)
  out.setUint32(0, a0, true)
  out.setUint32(4, b0, true)
  out.setUint32(8, c0, true)
  out.setUint32(12, d0, true)
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')
}

export class EspToolAdapter {
  private readonly portRef: { current: SerialPort | null }

  private readonly transportRef: { current: Transport | null }

  private readonly addLog: LogFn

  constructor(portRef: { current: SerialPort | null }, transportRef: { current: Transport | null }, addLog: LogFn) {
    this.portRef = portRef
    this.transportRef = transportRef
    this.addLog = addLog
  }

  async disconnect(closePort = true): Promise<void> {
    if (this.transportRef.current) {
      try {
        await this.transportRef.current.disconnect()
      } catch {
        // ignore disconnect cleanup errors
      }
      this.transportRef.current = null
    }

    if (closePort && this.portRef.current?.readable) {
      try {
        await this.portRef.current.close()
      } catch {
        // ignore close cleanup errors
      }
    }
  }

  async connect(baudRate = 115200): Promise<ChipInfo> {
    const { loader } = await this.openLoader(baudRate)

    const chipName = loader.chip.CHIP_NAME
    const macAddress = await loader.chip.readMac(loader)
    const flashIdValue = await loader.readFlashId()
    const flashSize = await loader.detectFlashSize()

    return {
      chipName,
      macAddress,
      flashId: hex(flashIdValue),
      flashSize,
    }
  }

  async detectFlashSize(): Promise<string> {
    const { loader } = await this.openLoader(115200)
    return loader.detectFlashSize()
  }

  async writeFlash(options: WriteFlashOptions): Promise<{ results: Array<{ name: string; address: number; passed: boolean; expectedMd5: string; actualMd5: string }> }> {
    const { loader } = await this.openLoader(options.baudRate)

    await loader.writeFlash({
      fileArray: options.fileArray.map(file => ({ data: file.data, address: file.address })),
      flashSize: options.flashSize ?? 'keep',
      flashMode: 'keep',
      flashFreq: 'keep',
      eraseAll: options.eraseAll,
      compress: options.compress,
      reportProgress: (_fileIndex: number, written: number, total: number) => {
        if (total > 0) {
          options.reportProgress?.(Math.round((written / total) * 100))
        }
      },
      calculateMD5Hash: options.verify ? md5Hex : undefined,
    })

    const results = []
    for (const file of options.fileArray) {
      const expectedMd5 = md5Hex(file.data)
      let actualMd5 = ''
      let passed = true
      if (options.verify) {
        actualMd5 = await loader.flashMd5sum(file.address, file.data.length)
        passed = actualMd5.toLowerCase() === expectedMd5.toLowerCase()
      }
      results.push({
        name: file.name,
        address: file.address,
        passed,
        expectedMd5,
        actualMd5,
      })
    }

    if (options.reboot) {
      await loader.after('hard_reset')
    }

    return { results }
  }

  async readFlash(address: number, size: number, onProgress?: (read: number, total: number) => void): Promise<Uint8Array> {
    const { loader } = await this.openLoader(115200)
    return loader.readFlash(address, size, (_packet: Uint8Array, progress: number, total: number) => {
      onProgress?.(progress, total)
    })
  }

  async eraseFlash(): Promise<void> {
    const { loader } = await this.openLoader(115200)
    await loader.eraseFlash()
  }

  private async openLoader(baudRate: number): Promise<LoaderSession> {
    if (!this.portRef.current) {
      throw new Error('No serial port connected')
    }

    await this.disconnect(false)

    if (this.portRef.current.readable) {
      try {
        await this.portRef.current.close()
      } catch {
        // ignore close retries
      }
    }

    const transport = new Transport(this.portRef.current, true)
    this.transportRef.current = transport

    const loader = new ESPLoader({
      transport,
      baudrate: baudRate,
      terminal: {
        clean: () => {},
        writeLine: (data: string) => this.addLog(data, 'info'),
        write: (data: string) => {
          if (data.trim()) this.addLog(data.trim(), 'info')
        },
      },
    })

    await loader.main()
    return { transport, loader }
  }
}
