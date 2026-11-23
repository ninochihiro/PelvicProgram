export const PRESSURE_GAUGE_BAUD = 2400
export const PRESSURE_GAUGE_START_COMMAND = 0x65
export const PRESSURE_FRAME_SIZE = 8

export function asciiNibbleToInt(value) {
  if (value >= 0x30 && value <= 0x39) return value - 0x30
  if (value >= 0x41 && value <= 0x46) return value - 0x37
  if (value >= 0x61 && value <= 0x66) return value - 0x57
  throw new Error(`无效压力计半字节: 0x${value.toString(16)}`)
}

export function parsePressureFrame(frame) {
  if (!frame || frame.length < PRESSURE_FRAME_SIZE) {
    throw new Error('压力计帧长度不足')
  }

  const buffer = Buffer.isBuffer(frame) ? frame : Buffer.from(frame)
  if (buffer[0] !== 0x55 || buffer[1] !== 0x01) {
    throw new Error('压力计帧头不正确')
  }

  const sign = buffer[2] === 0x2b ? 1 : -1
  const digits = Array.from(buffer.subarray(3, 8), asciiNibbleToInt)
  const raw =
    (digits[0] << 16) |
    (digits[1] << 12) |
    (digits[2] << 8) |
    (digits[3] << 4) |
    digits[4]

  return Math.round(raw * 0.1 * sign * 10) / 10
}

export function extractPressureFrames(inputBuffer, chunk = Buffer.alloc(0)) {
  let buffer = Buffer.concat([inputBuffer, chunk])
  const frames = []

  if (buffer.length > 4096) buffer = buffer.subarray(-4096)

  while (buffer.length >= 2) {
    const start = buffer.indexOf(0x55)
    if (start < 0) {
      buffer = Buffer.alloc(0)
      break
    }
    if (start > 0) buffer = buffer.subarray(start)
    if (buffer.length < 2) break

    if (buffer[1] === 0x02) {
      buffer = buffer.subarray(2)
      continue
    }
    if (buffer[1] !== 0x01) {
      buffer = buffer.subarray(1)
      continue
    }
    if (buffer.length < PRESSURE_FRAME_SIZE) break

    frames.push(buffer.subarray(0, PRESSURE_FRAME_SIZE))
    buffer = buffer.subarray(PRESSURE_FRAME_SIZE)
  }

  return { buffer, frames }
}
