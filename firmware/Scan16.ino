#include <Arduino.h>
#include <Adafruit_TinyUSB.h>
#include "nrf_saadc.h"
#include <math.h>

constexpr uint8_t CHANNEL_COUNT = 15;

constexpr int PIN_S0 = D1;
constexpr int PIN_S1 = D2;
constexpr int PIN_S2 = D3;
constexpr int PIN_S3 = D4;

constexpr uint32_t SETTLE_US = 2000;

constexpr float V_DRIVE = 0.625f;
constexpr float R_FEEDBACK_K = 152.0f;
constexpr float R_OFFSET_K = 0.226f;
constexpr float ADC_LSB = 16384.0f;
constexpr float ADC_FULL_SCALE = 3.0f;
constexpr uint32_t FRAME_INTERVAL_MS = 50;

// MUX 地址 -> 实际通道号 A01~A15
constexpr uint8_t MUX_TO_CH[16] = {
    1, 2, 3, 8, 7, 6, 5, 4,
    9, 10, 11, 12, 13, 14, 15, 0
};

int16_t adc_value = 0;

uint16_t raw_frame[CHANNEL_COUNT];
float voltage_frame[CHANNEL_COUNT];
float resistance_frame[CHANNEL_COUNT];

uint32_t makeAdcConfig(uint32_t gain)
{
    return (SAADC_CH_CONFIG_REFSEL_Internal << SAADC_CH_CONFIG_REFSEL_Pos) |
           (gain << SAADC_CH_CONFIG_GAIN_Pos) |
           (SAADC_CH_CONFIG_TACQ_20us << SAADC_CH_CONFIG_TACQ_Pos) |
           (SAADC_CH_CONFIG_MODE_SE << SAADC_CH_CONFIG_MODE_Pos) |
           (SAADC_CH_CONFIG_BURST_Enabled << SAADC_CH_CONFIG_BURST_Pos);
}

void saadcInit()
{
    NRF_SAADC->RESOLUTION = SAADC_RESOLUTION_VAL_14bit;
    NRF_SAADC->OVERSAMPLE = SAADC_OVERSAMPLE_OVERSAMPLE_Over16x;

    // 测试数据最高约 1.69 V。固定 3 V 档可覆盖全部压力范围，
    // 避免自动切档造成 ADC 原值突变。
    NRF_SAADC->CH[0].CONFIG =
        makeAdcConfig(SAADC_CH_CONFIG_GAIN_Gain1_5);
    NRF_SAADC->CH[0].PSELP = SAADC_CH_PSELP_PSELP_AnalogInput0;
    NRF_SAADC->CH[0].PSELN = SAADC_CH_PSELN_PSELN_NC;

    NRF_SAADC->ENABLE = SAADC_ENABLE_ENABLE_Enabled;

    NRF_SAADC->EVENTS_CALIBRATEDONE = 0;
    NRF_SAADC->TASKS_CALIBRATEOFFSET = 1;
    while (NRF_SAADC->EVENTS_CALIBRATEDONE == 0) {}
    NRF_SAADC->EVENTS_CALIBRATEDONE = 0;
}

int16_t saadcRead()
{
    NRF_SAADC->EVENTS_STARTED = 0;
    NRF_SAADC->EVENTS_END = 0;
    NRF_SAADC->EVENTS_STOPPED = 0;

    NRF_SAADC->RESULT.PTR = (uint32_t)&adc_value;
    NRF_SAADC->RESULT.MAXCNT = 1;

    NRF_SAADC->TASKS_START = 1;
    while (NRF_SAADC->EVENTS_STARTED == 0) {}
    NRF_SAADC->EVENTS_STARTED = 0;

    NRF_SAADC->TASKS_SAMPLE = 1;
    while (NRF_SAADC->EVENTS_END == 0) {}
    NRF_SAADC->EVENTS_END = 0;

    NRF_SAADC->TASKS_STOP = 1;
    while (NRF_SAADC->EVENTS_STOPPED == 0) {}
    NRF_SAADC->EVENTS_STOPPED = 0;

    return adc_value < 0 ? 0 : adc_value;
}

void selectMux(uint8_t address)
{
    digitalWrite(PIN_S0, address & 0x01);
    digitalWrite(PIN_S1, (address >> 1) & 0x01);
    digitalWrite(PIN_S2, (address >> 2) & 0x01);
    digitalWrite(PIN_S3, (address >> 3) & 0x01);
}

uint16_t sampleOneMuxChannel(uint8_t address)
{
    selectMux(address);
    delayMicroseconds(SETTLE_US);

    saadcRead();
    return static_cast<uint16_t>(saadcRead());
}

void scanAllChannels()
{
    for (uint8_t address = 0; address < CHANNEL_COUNT; address++) {
        const uint16_t raw = sampleOneMuxChannel(address);
        const uint8_t physical_ch = MUX_TO_CH[address];
        const uint8_t index = physical_ch - 1;
        const float voltage = raw * ADC_FULL_SCALE / ADC_LSB;

        raw_frame[index] = raw;
        voltage_frame[index] = voltage;

        if (voltage > 0.001f) {
            resistance_frame[index] =
                V_DRIVE * R_FEEDBACK_K / voltage - R_OFFSET_K;
        } else {
            resistance_frame[index] = INFINITY;
        }
    }
}

void printDebugFrame()
{
    // 固定 3 V 档，按 A01~A15 顺序输出 15 个 ADC 原值。
    for (uint8_t i = 0; i < CHANNEL_COUNT; i++) {
        Serial.print(raw_frame[i]);
        if (i + 1 < CHANNEL_COUNT) Serial.print(',');
    }
    Serial.println();
}

void setup()
{
    Serial.begin(460800);

    pinMode(PIN_S0, OUTPUT);
    pinMode(PIN_S1, OUTPUT);
    pinMode(PIN_S2, OUTPUT);
    pinMode(PIN_S3, OUTPUT);

    selectMux(0);
    saadcInit();
}

void loop()
{
    const uint32_t frame_start = millis();

    scanAllChannels();
    printDebugFrame();

    const uint32_t elapsed = millis() - frame_start;
    if (elapsed < FRAME_INTERVAL_MS) {
        delay(FRAME_INTERVAL_MS - elapsed);
    }
}
