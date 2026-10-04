#!/usr/bin/env python3
"""Generate the default SVA sound bank (sounds/*.wav) with the Python standard library only.

Every file is synthesized (noise, sines, envelopes, one-pole filters), so the bank is original
work under the module's license and small enough to ship. Replace any file with your own of the
same name, or point the "Sound folder" setting at another folder with the same file names.

    python3 tools/generate-sounds.py          # writes sounds/<name>.wav
"""
import math
import os
import random
import struct
import wave

RATE = 22050
OUT = os.path.join(os.path.dirname(__file__), "..", "sounds")
random.seed(42)


def ms(n):
    return int(RATE * n / 1000)


def silence(n):
    return [0.0] * n


def noise(n, amp=1.0):
    return [random.uniform(-amp, amp) for _ in range(n)]


def sine(freq, n, amp=1.0, freq_end=None, phase=0.0):
    out = []
    f0 = freq
    f1 = freq if freq_end is None else freq_end
    ph = phase
    for i in range(n):
        t = i / max(1, n - 1)
        f = f0 + (f1 - f0) * t
        ph += 2 * math.pi * f / RATE
        out.append(amp * math.sin(ph))
    return out


def env(samples, attack=5, decay=200, hold=0, curve=2.0):
    a, h, d = ms(attack), ms(hold), ms(decay)
    out = []
    for i, s in enumerate(samples):
        if i < a:
            g = i / max(1, a)
        elif i < a + h:
            g = 1.0
        else:
            x = (i - a - h) / max(1, d)
            g = max(0.0, 1 - x) ** curve if x < 1 else 0.0
        out.append(s * g)
    return out


def lowpass(samples, cutoff, cutoff_end=None):
    out, y = [], 0.0
    c0 = cutoff
    c1 = cutoff if cutoff_end is None else cutoff_end
    n = max(1, len(samples) - 1)
    for i, s in enumerate(samples):
        c = c0 + (c1 - c0) * i / n
        a = min(1.0, 2 * math.pi * c / RATE)
        y += a * (s - y)
        out.append(y)
    return out


def highpass(samples, cutoff):
    return [s - l for s, l in zip(samples, lowpass(samples, cutoff))]


def gain(samples, g):
    return [s * g for s in samples]


def mix(*layers):
    n = max(len(l) + ms(start) for l, start in layers)
    out = [0.0] * n
    for layer, start in layers:
        o = ms(start)
        for i, s in enumerate(layer):
            if o + i < n:
                out[o + i] += s
    return out


def tremolo(samples, hz, depth=0.5):
    return [s * (1 - depth + depth * 0.5 * (1 + math.sin(2 * math.pi * hz * i / RATE))) for i, s in enumerate(samples)]


def normalize(samples, peak=0.7):
    m = max(1e-6, max(abs(s) for s in samples))
    return [s * peak / m for s in samples]


def write(name, samples):
    data = normalize(samples)
    # short fade at the end so nothing clicks
    tail = ms(8)
    for i in range(tail):
        data[-1 - i] *= i / tail
    path = os.path.join(OUT, f"{name}.wav")
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, s)) * 32767)) for s in data))
    print(f"{name}.wav  {len(data) / RATE:.2f}s")


# ---- building blocks -------------------------------------------------------------------------

def whoosh(length=260, lo=600, hi=2800, attack=30):
    n = ms(length)
    return env(lowpass(highpass(noise(n), 300), lo, hi), attack, length - attack, curve=1.5)


def thud(freq=90, length=180, amp=1.0):
    return env(sine(freq, ms(length), amp, freq * 0.55), 2, length - 2, curve=2.5)


def click(length=25, cutoff=4000):
    return env(highpass(noise(ms(length)), cutoff), 1, length - 1, curve=1.2)


def crunch(length=90):
    n = ms(length)
    return env(lowpass(noise(n), 1800, 700), 3, length - 3)


def ring(freq, length=500, amp=0.5):
    tone = mix((sine(freq, ms(length), amp), 0), (sine(freq * 2.01, ms(length), amp * 0.3), 0))
    return env(tone, 2, length - 2, curve=1.8)


def chime(freqs, step=70, length=450, amp=0.6):
    layers = [(ring(f, length, amp), i * step) for i, f in enumerate(freqs)]
    return mix(*layers)


def crackle(length=500, density=140, cutoff=2200):
    n = ms(length)
    out = silence(n)
    for _ in range(int(density * length / 1000)):
        at = random.randrange(0, n - ms(6))
        burst = env(noise(ms(6)), 0.5, 5.5, curve=1.0)
        for i, s in enumerate(burst):
            out[at + i] += s * random.uniform(0.3, 1.0)
    return lowpass(out, cutoff)


def crit_layer():
    boom = thud(55, 420, 1.0)
    splash = env(lowpass(noise(ms(350)), 3500, 400), 2, 348)
    metal = ring(1180, 520, 0.35)
    return mix((boom, 0), (gain(splash, 0.5), 0), (metal, 10))


# ---- attacks -----------------------------------------------------------------------------------

def melee_slash():
    return mix((whoosh(260, 500, 3200), 0), (gain(click(18, 3000), 0.5), 150), (gain(thud(120, 120), 0.35), 150))


def melee_pierce():
    return mix((whoosh(150, 900, 4500, 15), 0), (click(30, 2500), 110), (gain(thud(140, 90), 0.4), 110))


def melee_blunt():
    return mix((gain(whoosh(220, 300, 1500), 0.7), 0), (thud(85, 260, 1.0), 160), (gain(crunch(60), 0.4), 160))


def unarmed():
    return mix((gain(whoosh(140, 400, 1800, 20), 0.6), 0), (thud(110, 150, 0.9), 90), (gain(click(20, 1500), 0.6), 90))


def bite():
    snap = lambda: mix((click(30, 1800), 0), (thud(160, 70, 0.6), 0))
    return mix((snap(), 0), (gain(crunch(140), 0.9), 60), (snap(), 110))


def claw():
    return mix((whoosh(160, 900, 4000, 12), 0), (whoosh(160, 1000, 4500, 12), 60), (whoosh(180, 800, 3800, 12), 120),
               (gain(click(25, 2500), 0.5), 170))


def bow():
    twang = env(mix((sine(170, ms(260), 0.8, 150), 0), (sine(340, ms(200), 0.4), 0), (sine(680, ms(120), 0.2), 0)), 1, 240, curve=2.2)
    return mix((twang, 0), (gain(whoosh(320, 1200, 4500, 10), 0.6), 30))


def crossbow():
    twang = env(mix((sine(120, ms(220), 0.9, 100), 0), (sine(240, ms(160), 0.4), 0)), 1, 200, curve=2.5)
    return mix((click(30, 2000), 0), (twang, 20), (gain(whoosh(300, 1400, 5000, 8), 0.7), 50))


def firearm():
    bang = env(noise(ms(70)), 0.5, 69, curve=1.3)
    boom = thud(60, 380, 1.0)
    tail = env(lowpass(noise(ms(500)), 1200, 300), 5, 495, curve=2.0)
    return mix((bang, 0), (boom, 5), (gain(tail, 0.5), 40))


def throw():
    return mix((whoosh(380, 400, 2200, 60), 0), (gain(whoosh(200, 600, 2600, 20), 0.5), 220))


def miss():
    return whoosh(320, 500, 2600, 40)


# ---- magic -------------------------------------------------------------------------------------

def magic_fire():
    return mix((crackle(650, 160, 2000), 0), (gain(whoosh(500, 200, 1800, 120), 0.9), 0), (gain(thud(70, 300), 0.5), 120))


def magic_cold():
    shimmer = tremolo(mix((sine(2200, ms(700), 0.4), 0), (sine(3300, ms(700), 0.3), 0), (sine(4400, ms(600), 0.2), 0)), 9, 0.6)
    sweep = env(sine(1800, ms(600), 0.5, 500), 40, 560)
    return mix((env(shimmer, 60, 600), 0), (sweep, 50), (gain(lowpass(noise(ms(500)), 5000), 0.15), 0))


def magic_electricity():
    buzz = tremolo(crackle(550, 400, 5000), 55, 0.9)
    zap = env(highpass(noise(ms(120)), 1500), 1, 119)
    return mix((buzz, 0), (zap, 0), (gain(ring(900, 300, 0.3), 0.5), 30))


def magic_acid():
    n = ms(700)
    out = silence(n)
    for _ in range(26):
        at = random.randrange(0, n - ms(60))
        f = random.uniform(300, 1100)
        blip = env(sine(f, ms(50), 0.6, f * 1.6), 2, 48)
        for i, s in enumerate(blip):
            out[at + i] += s
    return mix((out, 0), (gain(env(lowpass(noise(n), 900), 50, 650), 0.5), 0))


def magic_poison():
    return mix((env(lowpass(noise(ms(800)), 3000, 1200), 80, 720, curve=1.6), 0), (gain(tremolo(crackle(500, 60, 1200), 12, 0.7), 0.4), 100))


def magic_sonic():
    tone = mix((sine(700, ms(650), 0.6), 0), (sine(1400, ms(650), 0.3), 0), (sine(2100, ms(500), 0.15), 0))
    tone = [s * (1 + 0.08 * math.sin(2 * math.pi * 6 * i / RATE)) for i, s in enumerate(tone)]
    return mix((env(tone, 10, 640, curve=1.3), 0), (gain(click(15, 2000), 0.4), 0))


def magic_force():
    return mix((env(sine(220, ms(450), 0.7, 880), 20, 430, curve=1.4), 0), (gain(thud(80, 250), 0.7), 330), (gain(ring(1600, 300, 0.3), 0.6), 330))


def magic_void():
    drone = env(mix((sine(160, ms(800), 0.6, 55), 0), (sine(240, ms(800), 0.3, 80), 0)), 60, 740, curve=1.3)
    return mix((drone, 0), (gain(env(lowpass(noise(ms(800)), 600, 150), 100, 700), 0.6), 0))


def magic_vitality():
    return mix((chime([523, 659, 784, 1047], 60, 600, 0.6), 0), (gain(env(lowpass(noise(ms(600)), 6000, 2000), 100, 500), 0.12), 0))


def magic_mental():
    warble = [s for s in sine(420, ms(700), 0.6)]
    warble = [s * (1 + 0.6 * math.sin(2 * math.pi * 7 * i / RATE)) for i, s in enumerate(warble)]
    deep = sine(420, ms(700), 0.5, 300)
    return mix((env(warble, 40, 660), 0), (env(deep, 40, 660), 0), (gain(ring(1700, 400, 0.25), 0.6), 200))


def magic_spirit():
    shimmer = tremolo(mix((sine(1760, ms(700), 0.35), 0), (sine(2637, ms(650), 0.25), 0)), 5, 0.5)
    return mix((env(shimmer, 80, 620), 0), (chime([880, 1319], 120, 500, 0.5), 60))


def magic_generic():
    return mix((env(sine(300, ms(400), 0.5, 1200), 20, 380), 0), (chime([988, 1319], 90, 450, 0.5), 150), (gain(env(lowpass(noise(ms(500)), 5000, 1500), 60, 440), 0.15), 0))


def healing():
    return mix((chime([659, 784, 988, 1319], 90, 700, 0.55), 0), (gain(env(mix((sine(330, ms(800), 0.4), 0), (sine(495, ms(800), 0.3), 0)), 150, 650, curve=1.2), 0.6), 0))


def buff():
    return mix((env(sine(500, ms(350), 0.5, 1500), 15, 335), 0), (gain(env(tremolo(sine(2500, ms(400), 0.3), 10, 0.5), 50, 350), 0.7), 80))


BANK = {
    "melee-slash": melee_slash,
    "melee-pierce": melee_pierce,
    "melee-blunt": melee_blunt,
    "unarmed": unarmed,
    "bite": bite,
    "claw": claw,
    "bow": bow,
    "crossbow": crossbow,
    "firearm": firearm,
    "throw": throw,
    "miss": miss,
    "magic-fire": magic_fire,
    "magic-cold": magic_cold,
    "magic-electricity": magic_electricity,
    "magic-acid": magic_acid,
    "magic-poison": magic_poison,
    "magic-sonic": magic_sonic,
    "magic-force": magic_force,
    "magic-void": magic_void,
    "magic-vitality": magic_vitality,
    "magic-mental": magic_mental,
    "magic-spirit": magic_spirit,
    "magic": magic_generic,
    "healing": healing,
    "buff": buff,
}

CRIT_BASES = ["melee-slash", "melee-pierce", "melee-blunt", "unarmed", "bite", "claw", "bow", "crossbow", "firearm", "throw", "magic"]


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, make in BANK.items():
        write(name, make())
    for base in CRIT_BASES:
        write(f"crit-{base}", mix((BANK[base](), 0), (crit_layer(), 120)))


if __name__ == "__main__":
    main()
