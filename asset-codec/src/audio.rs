// QOA quantization follows the existing qoa-format encoder.
// See packaging/dependency-licenses/qoa-format.txt.
use wasm_bindgen::prelude::*;

const FRAME_SAMPLES: usize = 5120;
const SLICE_SAMPLES: usize = 20;
const SCALE: [i32; 16] = [
    1, 7, 21, 45, 84, 138, 211, 304, 421, 562, 731, 928, 1157, 1419, 1715, 2048,
];
const QUANT: [u64; 17] = [7, 7, 7, 5, 5, 3, 3, 1, 0, 0, 2, 2, 4, 4, 6, 6, 6];
const DEQUANT: [[i32; 8]; 16] = {
    let mut table = [[0; 8]; 16];
    let factors = [3, 10, 18, 28];
    let mut scale = 0;
    while scale < 16 {
        let mut index = 0;
        while index < 4 {
            let value = (SCALE[scale] * factors[index] + 2) / 4;
            table[scale][index * 2] = value;
            table[scale][index * 2 + 1] = -value;
            index += 1;
        }
        scale += 1;
    }
    table
};

#[derive(Clone, Copy)]
struct Predictor {
    history: [i16; 4],
    weights: [i16; 4],
}

impl Predictor {
    fn predict(self) -> i32 {
        self.weights
            .into_iter()
            .zip(self.history)
            .fold(0i32, |sum, (weight, sample)| {
                sum.wrapping_add(i32::from(weight) * i32::from(sample))
            })
            >> 13
    }

    fn update(&mut self, sample: i32, residual: i32) {
        let delta = (residual >> 4) as i16;
        for (weight, history) in self.weights.iter_mut().zip(self.history) {
            *weight = weight.wrapping_add(if history < 0 { -delta } else { delta });
        }
        self.history.rotate_left(1);
        self.history[3] = sample as i16;
    }
}

fn encode_slice(samples: &[i16], predictor: &mut Predictor) -> u64 {
    let mut best_error = u64::MAX;
    let mut best_slice = 0;
    let mut best_predictor = *predictor;
    for (index, scale) in SCALE.into_iter().enumerate() {
        let reciprocal = (65536 + scale - 1) / scale;
        let mut candidate = *predictor;
        let mut bits = index as u64;
        let mut error = 0;
        for &sample in samples {
            let predicted = candidate.predict();
            let sample = i32::from(sample);
            let residual = sample - predicted;
            let rounded = residual.wrapping_mul(reciprocal).wrapping_add(32768) >> 16;
            let scaled = rounded + residual.signum() - rounded.signum();
            let quantized = QUANT[(scaled.clamp(-8, 8) + 8) as usize];
            let dequantized = DEQUANT[index][quantized as usize];
            let reconstructed = (predicted + dequantized).clamp(-32768, 32767);
            let difference = i64::from(sample - reconstructed);
            error += (difference * difference) as u64;
            if error >= best_error {
                break;
            }
            candidate.update(reconstructed, dequantized);
            bits = (bits << 3) | quantized;
        }
        if error < best_error {
            best_error = error;
            best_slice = bits << ((SLICE_SAMPLES - samples.len()) * 3);
            best_predictor = candidate;
        }
    }
    *predictor = best_predictor;
    best_slice
}

fn encode(
    frames: usize,
    channels: usize,
    rate: u32,
    sample: impl Fn(usize, usize) -> i16,
) -> Vec<u8> {
    let frame_header = 8 + channels * 16;
    let mut output = Vec::with_capacity(
        8 + frames.div_ceil(FRAME_SAMPLES) * frame_header
            + frames.div_ceil(SLICE_SAMPLES) * channels * 8,
    );
    output.extend_from_slice(b"qoaf");
    output.extend_from_slice(&(frames as u32).to_be_bytes());
    let mut predictors = [Predictor {
        history: [0; 4],
        weights: [0, 0, -8192, 16384],
    }; 2];
    let predictors = &mut predictors[..channels];
    for start in (0..frames).step_by(FRAME_SAMPLES) {
        let count = (frames - start).min(FRAME_SAMPLES);
        let size = frame_header + count.div_ceil(SLICE_SAMPLES) * channels * 8;
        output.extend_from_slice(&(rate | (channels as u32) << 24).to_be_bytes());
        output.extend_from_slice(&(count as u16).to_be_bytes());
        output.extend_from_slice(&(size as u16).to_be_bytes());
        for predictor in predictors.iter_mut() {
            if predictor
                .weights
                .iter()
                .map(|&weight| i64::from(weight).pow(2))
                .sum::<i64>()
                > 0x2fffffff
            {
                predictor.weights.fill(0);
            }
            for value in predictor.history.into_iter().chain(predictor.weights) {
                output.extend_from_slice(&value.to_be_bytes());
            }
        }
        for offset in (0..count).step_by(SLICE_SAMPLES) {
            let length = (count - offset).min(SLICE_SAMPLES);
            for (channel, predictor) in predictors.iter_mut().enumerate() {
                let mut slice = [0; SLICE_SAMPLES];
                for (index, value) in slice[..length].iter_mut().enumerate() {
                    *value = sample(start + offset + index, channel);
                }
                output.extend_from_slice(&encode_slice(&slice[..length], predictor).to_be_bytes());
            }
        }
    }
    output
}

fn quantize(sample: f32) -> i16 {
    let sample = if sample.is_finite() {
        sample.clamp(-1., 1.)
    } else {
        0.
    };
    (sample * if sample < 0. { 32768. } else { 32767. }).floor() as i16
}

#[wasm_bindgen]
pub fn encode_stereo_qoa(rate: u32, left: &[f32], right: &[f32]) -> Result<Vec<u8>, String> {
    if rate == 0 || rate > 384000 || left.is_empty() || left.len() != right.len() {
        return Err("Invalid stereo audio samples or sample rate".into());
    }
    let channels = [left, right];
    Ok(encode(left.len(), 2, rate, |frame, channel| {
        quantize(channels[channel][frame])
    }))
}

#[wasm_bindgen]
pub fn wav_to_qoa(bytes: &[u8]) -> Result<Vec<u8>, String> {
    if bytes.get(..4) != Some(b"RIFF") || bytes.get(8..12) != Some(b"WAVE") {
        return Err("Invalid WAV header".into());
    }
    let mut format = &[][..];
    let mut pcm = &[][..];
    let mut remaining = &bytes[12..];
    while let Some(header) = remaining.get(..8) {
        let size = u32::from_le_bytes(header[4..8].try_into().unwrap()) as usize;
        let chunk = remaining[8..].get(..size).ok_or("Truncated WAV chunk")?;
        match &header[..4] {
            b"fmt " => format = chunk,
            b"data" => pcm = chunk,
            _ => {}
        }
        let tail = &remaining[8 + size..];
        remaining = tail.get(size % 2..).unwrap_or_default();
    }
    if format.len() < 16 || pcm.is_empty() {
        return Err("WAV is missing format or samples".into());
    }
    let word = |offset| u16::from_le_bytes([format[offset], format[offset + 1]]);
    let mut kind = word(0);
    if kind == 0xfffe && format.len() >= 40 {
        kind = word(24);
    }
    let channels = usize::from(word(2));
    let rate = u32::from_le_bytes(format[4..8].try_into().unwrap());
    let bits = word(14);
    if !(1..=2).contains(&channels)
        || rate == 0
        || rate > 384000
        || !(kind == 1 && matches!(bits, 8 | 16 | 24 | 32) || kind == 3 && bits == 32)
    {
        return Err("Use mono or stereo PCM or float32 WAV, or set compress to false".into());
    }
    let bytes = usize::from(bits / 8);
    let count = pcm.len() / (channels * bytes);
    if count == 0 {
        return Err("WAV contains no complete samples".into());
    }
    Ok(encode(count, channels, rate, |frame, channel| {
        let offset = (frame * channels + channel) * bytes;
        let sample = &pcm[offset..offset + bytes];
        let value = match (kind, bits) {
            (3, _) => f32::from_le_bytes(sample.try_into().unwrap()),
            (_, 8) => (f32::from(sample[0]) - 128.) / 128.,
            (_, 16) => f32::from(i16::from_le_bytes(sample.try_into().unwrap())) / 32768.,
            (_, 24) => {
                (i32::from_le_bytes([0, sample[0], sample[1], sample[2]]) >> 8) as f32 / 8388608.
            }
            _ => i32::from_le_bytes(sample.try_into().unwrap()) as f32 / 2147483648.,
        };
        quantize(value)
    }))
}
