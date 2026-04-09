/// <reference types="vite/client" />

interface SerialPortRequestOptions {
  filters?: SerialPortFilter[]
}

interface SerialPortFilter {
  usbVendorId?: number
  usbProductId?: number
}

interface SerialOptions {
  baudRate: number
  dataBits?: number
  stopBits?: number
  parity?: ParityType
  bufferSize?: number
  flowControl?: FlowControlType
}

type ParityType = 'none' | 'even' | 'odd'
type FlowControlType = 'none' | 'hardware'

interface SerialPort {
  readable: ReadableStream<Uint8Array> | null
  writable: WritableStream<Uint8Array> | null
  open(options: SerialOptions): Promise<void>
  close(): Promise<void>
  getInfo(): SerialPortInfo
}

interface SerialPortInfo {
  usbVendorId?: number
  usbProductId?: number
}

interface Serial extends EventTarget {
  requestPort(options?: SerialPortRequestOptions): Promise<SerialPort>
  getPorts(): Promise<SerialPort[]>
}

interface Navigator {
  serial: Serial
}
