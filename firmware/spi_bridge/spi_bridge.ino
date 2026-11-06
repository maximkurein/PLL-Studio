/*
  PLL Studio — USB-serial SPI bridge for the IDT/Renesas 8V97051
  ---------------------------------------------------------------
  Works on any Arduino-core board with a 3.3 V I/O level:
  STM32 Nucleo (STM32duino, via ST-LINK VCP), Raspberry Pi Pico (arduino-pico),
  ESP32, Arduino Zero/Due/Nano 33 ...

  !!! The 8V97051 SPI pins are 1.8 V logic, 3.3 V tolerant (abs. max VDDA + 0.5 V).
  !!! Never drive them from a 5 V board (Uno/Mega/Nano classic) without level shifters.

  Wiring (default pins, change below):
     MCU SCK  -> SCLK  (pin 1)
     MCU MOSI -> SDI   (pin 2)
     MCU D10  -> nCS   (pin 3, active low "load enable")
     MCU MISO <- MUX_OUT (pin 30, configure MUX_OUT = 111 "SDO" for readback)
     MCU D9   -> CE    (pin 4)    optional
     MCU D8   -> MUTE  (pin 26)   optional, low = outputs muted
     MCU D7   <- LD    (pin 25)   optional
     GND      -- GND

  Protocol (115200 8N1, one command per line, replies end with \n):
     ?            -> PLLBRIDGE 1.0 <board>
     X hhhhhhhh   -> OK hhhhhhhh   one 32-bit frame, MSB first, SPI mode 0
     CE 0|1       -> OK            CE pin level
     MUTE 0|1     -> OK            MUTE pin level (0 = muted)
     LD           -> OK 0|1        LD pin level
     SPI <hz>     -> OK            SCLK frequency (max 20 MHz per datasheet)
*/
#include <SPI.h>

#ifndef PIN_NCS
#define PIN_NCS 10
#endif
#ifndef PIN_CE
#define PIN_CE 9
#endif
#ifndef PIN_MUTE
#define PIN_MUTE 8
#endif
#ifndef PIN_LD
#define PIN_LD 7
#endif

#ifdef ARDUINO_BOARD
#define BOARD_NAME ARDUINO_BOARD
#else
#define BOARD_NAME "arduino"
#endif

static uint32_t spiHz = 1000000UL;
static char buf[64];
static uint8_t len = 0;

static uint32_t frame32(uint32_t w) {
  SPI.beginTransaction(SPISettings(spiHz, MSBFIRST, SPI_MODE0));
  digitalWrite(PIN_NCS, LOW);  // first SDO bit is driven on the nCS falling edge
  delayMicroseconds(1);
  uint32_t r = 0;
  for (int8_t i = 3; i >= 0; --i) {
    r = (r << 8) | SPI.transfer((uint8_t)(w >> (8 * i)));
  }
  delayMicroseconds(1);
  digitalWrite(PIN_NCS, HIGH);  // data is latched on the nCS rising edge
  SPI.endTransaction();
  delayMicroseconds(1);         // tPW >= 20 ns
  return r;
}

static void reply(const char* s) { Serial.print(s); Serial.print('\n'); }

static void handle(char* l) {
  while (*l == ' ') ++l;
  if (l[0] == '?') {
    Serial.print("PLLBRIDGE 1.0 ");
    Serial.print(BOARD_NAME);
    Serial.print('\n');
  } else if (l[0] == 'X' && l[1] == ' ') {
    uint32_t w = strtoul(l + 2, nullptr, 16);
    uint32_t r = frame32(w);
    char out[16];
    snprintf(out, sizeof(out), "OK %08lX", (unsigned long)r);
    reply(out);
  } else if (!strncmp(l, "CE ", 3)) {
    digitalWrite(PIN_CE, l[3] == '1' ? HIGH : LOW);
    reply("OK");
  } else if (!strncmp(l, "MUTE ", 5)) {
    digitalWrite(PIN_MUTE, l[5] == '1' ? HIGH : LOW);
    reply("OK");
  } else if (!strcmp(l, "LD")) {
    reply(digitalRead(PIN_LD) ? "OK 1" : "OK 0");
  } else if (!strncmp(l, "SPI ", 4)) {
    uint32_t hz = strtoul(l + 4, nullptr, 10);
    if (hz >= 10000UL && hz <= 20000000UL) { spiHz = hz; reply("OK"); }
    else reply("ERR range");
  } else if (l[0] == 0) {
    // empty line
  } else {
    reply("ERR unknown");
  }
}

void setup() {
  pinMode(PIN_NCS, OUTPUT);
  digitalWrite(PIN_NCS, HIGH);
  pinMode(PIN_CE, OUTPUT);
  digitalWrite(PIN_CE, HIGH);
  pinMode(PIN_MUTE, OUTPUT);
  digitalWrite(PIN_MUTE, HIGH);
  pinMode(PIN_LD, INPUT);
  SPI.begin();
  Serial.begin(115200);
}

void loop() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\r') continue;
    if (c == '\n') {
      buf[len] = 0;
      handle(buf);
      len = 0;
    } else if (len < sizeof(buf) - 1) {
      buf[len++] = c;
    }
  }
}
