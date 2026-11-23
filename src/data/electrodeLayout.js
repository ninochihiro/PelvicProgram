const electrodeDefinitions = [
  { legacyId: 'A01', physicalSource: 'CH1', x: 77.66, y: 75.85 },
  { legacyId: 'A02', physicalSource: 'CH2', x: 76.69, y: 55.77 },
  { legacyId: 'A03', physicalSource: 'CH3', x: 89.29, y: 45.97 },
  { legacyId: 'A04', physicalSource: 'CH4', x: 91.91, y: 26.13 },
  { legacyId: 'A05', physicalSource: 'CH5', x: 72.79, y: 36.01 },
  { legacyId: 'A06', physicalSource: 'CH6', x: 53.19, y: 19.76 },
  { legacyId: 'A07', physicalSource: 'CH7', x: 55.28, y: 37.78 },
  { legacyId: 'A08', physicalSource: 'CH8', x: 47.14, y: 59.17 },
  { legacyId: 'A09', physicalSource: "CH7'", x: 39.97, y: 37.98 },
  { legacyId: 'A10', physicalSource: "CH6'", x: 43.12, y: 19.76 },
  { legacyId: 'A11', physicalSource: "CH5'", x: 22.91, y: 37.19 },
  { legacyId: 'A12', physicalSource: "CH4'", x: 6.94, y: 28.74 },
  { legacyId: 'A13', physicalSource: "CH3'", x: 7.84, y: 47.55 },
  { legacyId: 'A14', physicalSource: "CH2'", x: 18.26, y: 57.04 },
  { legacyId: 'A15', physicalSource: "CH1'", x: 16.99, y: 76.32 }
]

const desiredLegacyOrder = [
  'A01',
  'A02',
  'A03',
  'A04',
  'A05',
  'A06',
  'A07',
  'A08',
  'A09',
  'A10',
  'A11',
  'A12',
  'A13',
  'A14',
  'A15'
]

// Version 8 mirrored the horizontal screen order.
const version8LegacyOrder = [
  'A04',
  'A03',
  'A01',
  'A02',
  'A05',
  'A07',
  'A06',
  'A08',
  'A10',
  'A09',
  'A11',
  'A14',
  'A15',
  'A13',
  'A12'
]

// Version 7 followed physical serial order.
const version7LegacyOrder = [
  'A01',
  'A02',
  'A03',
  'A04',
  'A05',
  'A06',
  'A07',
  'A08',
  'A09',
  'A10',
  'A11',
  'A12',
  'A13',
  'A14',
  'A15'
]

// Version 6 used the mirrored clock-face order.
const version6LegacyOrder = [
  'A15',
  'A14',
  'A13',
  'A12',
  'A11',
  'A10',
  'A09',
  'A08',
  'A07',
  'A06',
  'A05',
  'A04',
  'A03',
  'A02',
  'A01'
]

// Version 5 assigned numbers by horizontal screen position.
const version5LegacyOrder = [
  'A12',
  'A13',
  'A15',
  'A14',
  'A11',
  'A09',
  'A10',
  'A08',
  'A06',
  'A07',
  'A05',
  'A02',
  'A01',
  'A03',
  'A04'
]

// Version 4 followed the physical serial order and is reversed from here.
const version4LegacyOrder = [
  'A01',
  'A02',
  'A03',
  'A04',
  'A05',
  'A06',
  'A07',
  'A08',
  'A09',
  'A10',
  'A11',
  'A12',
  'A13',
  'A14',
  'A15'
]

// Version 3 used the reverse direction and must remain fixed for migration.
const version3LegacyOrder = [
  'A15',
  'A14',
  'A13',
  'A12',
  'A11',
  'A10',
  'A09',
  'A08',
  'A07',
  'A06',
  'A05',
  'A04',
  'A03',
  'A02',
  'A01'
]

// Version 2 used left-to-right screen coordinates and must remain fixed here
// so that configurations produced by that version can be migrated again.
const version2LegacyOrder = [
  'A13',
  'A12',
  'A15',
  'A11',
  'A14',
  'A10',
  'A09',
  'A08',
  'A06',
  'A07',
  'A05',
  'A02',
  'A01',
  'A03',
  'A04'
]

const definitionByLegacyId = new Map(
  electrodeDefinitions.map((position) => [position.legacyId, position])
)

export const ELECTRODE_LAYOUT = desiredLegacyOrder.map((legacyId, index) => {
  const position = definitionByLegacyId.get(legacyId)
  return {
    ...position,
    id: `A${String(index + 1).padStart(2, '0')}`,
    legacyIndex: Number(position.legacyId.slice(1)) - 1
  }
})

export const ELECTRODE_CHANNEL_IDS = ELECTRODE_LAYOUT.map(
  (position) => position.id
)

export function remapLegacyChannelArray(values) {
  if (!Array.isArray(values) || values.length < 15) {
    return Array(15).fill(null)
  }
  return ELECTRODE_LAYOUT.map((position) => values[position.legacyIndex])
}

export function remapLegacyChannels(channels, createEmptyChannel) {
  const channelMap = new Map(
    Array.isArray(channels)
      ? channels.map((channel) => [channel?.id, channel])
      : []
  )

  return ELECTRODE_LAYOUT.map((position, index) => {
    const legacyChannel = channelMap.get(position.legacyId)
    return {
      ...createEmptyChannel(index),
      ...legacyChannel,
      id: position.id
    }
  })
}

export function remapVersion2ChannelArray(values) {
  if (!Array.isArray(values) || values.length < 15) {
    return Array(15).fill(null)
  }
  return ELECTRODE_LAYOUT.map((position) => {
    const version2Index = version2LegacyOrder.indexOf(position.legacyId)
    return values[version2Index]
  })
}

export function remapVersion2Channels(channels, createEmptyChannel) {
  const channelMap = new Map(
    Array.isArray(channels)
      ? channels.map((channel) => [channel?.id, channel])
      : []
  )

  return ELECTRODE_LAYOUT.map((position, index) => {
    const version2Index = version2LegacyOrder.indexOf(position.legacyId)
    const version2Channel = channelMap.get(
      `A${String(version2Index + 1).padStart(2, '0')}`
    )
    return {
      ...createEmptyChannel(index),
      ...version2Channel,
      id: position.id
    }
  })
}

export function remapVersion3ChannelArray(values) {
  if (!Array.isArray(values) || values.length < 15) {
    return Array(15).fill(null)
  }
  return ELECTRODE_LAYOUT.map((position) => {
    const version3Index = version3LegacyOrder.indexOf(position.legacyId)
    return values[version3Index]
  })
}

export function remapVersion3Channels(channels, createEmptyChannel) {
  const channelMap = new Map(
    Array.isArray(channels)
      ? channels.map((channel) => [channel?.id, channel])
      : []
  )

  return ELECTRODE_LAYOUT.map((position, index) => {
    const version3Index = version3LegacyOrder.indexOf(position.legacyId)
    const version3Channel = channelMap.get(
      `A${String(version3Index + 1).padStart(2, '0')}`
    )
    return {
      ...createEmptyChannel(index),
      ...version3Channel,
      id: position.id
    }
  })
}

export function remapVersion4ChannelArray(values) {
  if (!Array.isArray(values) || values.length < 15) {
    return Array(15).fill(null)
  }
  return ELECTRODE_LAYOUT.map((position) => {
    const version4Index = version4LegacyOrder.indexOf(position.legacyId)
    return values[version4Index]
  })
}

export function remapVersion4Channels(channels, createEmptyChannel) {
  const channelMap = new Map(
    Array.isArray(channels)
      ? channels.map((channel) => [channel?.id, channel])
      : []
  )

  return ELECTRODE_LAYOUT.map((position, index) => {
    const version4Index = version4LegacyOrder.indexOf(position.legacyId)
    const version4Channel = channelMap.get(
      `A${String(version4Index + 1).padStart(2, '0')}`
    )
    return {
      ...createEmptyChannel(index),
      ...version4Channel,
      id: position.id
    }
  })
}

export function remapVersion5ChannelArray(values) {
  if (!Array.isArray(values) || values.length < 15) {
    return Array(15).fill(null)
  }
  return ELECTRODE_LAYOUT.map((position) => {
    const version5Index = version5LegacyOrder.indexOf(position.legacyId)
    return values[version5Index]
  })
}

export function remapVersion5Channels(channels, createEmptyChannel) {
  const channelMap = new Map(
    Array.isArray(channels)
      ? channels.map((channel) => [channel?.id, channel])
      : []
  )

  return ELECTRODE_LAYOUT.map((position, index) => {
    const version5Index = version5LegacyOrder.indexOf(position.legacyId)
    const version5Channel = channelMap.get(
      `A${String(version5Index + 1).padStart(2, '0')}`
    )
    return {
      ...createEmptyChannel(index),
      ...version5Channel,
      id: position.id
    }
  })
}

export function remapVersion6ChannelArray(values) {
  if (!Array.isArray(values) || values.length < 15) {
    return Array(15).fill(null)
  }
  return ELECTRODE_LAYOUT.map((position) => {
    const version6Index = version6LegacyOrder.indexOf(position.legacyId)
    return values[version6Index]
  })
}

export function remapVersion6Channels(channels, createEmptyChannel) {
  const channelMap = new Map(
    Array.isArray(channels)
      ? channels.map((channel) => [channel?.id, channel])
      : []
  )

  return ELECTRODE_LAYOUT.map((position, index) => {
    const version6Index = version6LegacyOrder.indexOf(position.legacyId)
    const version6Channel = channelMap.get(
      `A${String(version6Index + 1).padStart(2, '0')}`
    )
    return {
      ...createEmptyChannel(index),
      ...version6Channel,
      id: position.id
    }
  })
}

export function remapVersion7ChannelArray(values) {
  if (!Array.isArray(values) || values.length < 15) {
    return Array(15).fill(null)
  }
  return ELECTRODE_LAYOUT.map((position) => {
    const version7Index = version7LegacyOrder.indexOf(position.legacyId)
    return values[version7Index]
  })
}

export function remapVersion7Channels(channels, createEmptyChannel) {
  const channelMap = new Map(
    Array.isArray(channels)
      ? channels.map((channel) => [channel?.id, channel])
      : []
  )

  return ELECTRODE_LAYOUT.map((position, index) => {
    const version7Index = version7LegacyOrder.indexOf(position.legacyId)
    const version7Channel = channelMap.get(
      `A${String(version7Index + 1).padStart(2, '0')}`
    )
    return {
      ...createEmptyChannel(index),
      ...version7Channel,
      id: position.id
    }
  })
}

export function remapVersion8ChannelArray(values) {
  if (!Array.isArray(values) || values.length < 15) {
    return Array(15).fill(null)
  }
  return ELECTRODE_LAYOUT.map((position) => {
    const version8Index = version8LegacyOrder.indexOf(position.legacyId)
    return values[version8Index]
  })
}

export function remapVersion8Channels(channels, createEmptyChannel) {
  const channelMap = new Map(
    Array.isArray(channels)
      ? channels.map((channel) => [channel?.id, channel])
      : []
  )

  return ELECTRODE_LAYOUT.map((position, index) => {
    const version8Index = version8LegacyOrder.indexOf(position.legacyId)
    const version8Channel = channelMap.get(
      `A${String(version8Index + 1).padStart(2, '0')}`
    )
    return {
      ...createEmptyChannel(index),
      ...version8Channel,
      id: position.id
    }
  })
}
