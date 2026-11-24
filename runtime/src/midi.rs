use rustysynth::{MidiFile, MidiFileSequencer, SoundFont, Synthesizer, SynthesizerSettings};
use std::sync::Arc;
use wasm_bindgen::prelude::*;

/// Synthesize stereo output in contiguous channel planes for cartridge compilation.
#[wasm_bindgen]
pub fn render_midi(midi: &[u8], font: &[u8], rate: i32) -> Result<Vec<f32>, String> {
    if midi.len() > 8 * 1024 * 1024 || font.len() > 64 * 1024 * 1024 {
        return Err("MIDI or SoundFont exceeds the size limit".into());
    }
    let midi = Arc::new(MidiFile::new(&mut &*midi).map_err(|error| error.to_string())?);
    let seconds = midi.get_length();
    if !(0.0..=600.0).contains(&seconds) || seconds == 0.0 || !(16000..=48000).contains(&rate) {
        return Err("Choose MIDI music between zero and ten minutes".into());
    }
    let font = Arc::new(SoundFont::new(&mut &*font).map_err(|error| error.to_string())?);
    let synth = Synthesizer::new(&font, &SynthesizerSettings::new(rate))
        .map_err(|error| error.to_string())?;
    let mut sequencer = MidiFileSequencer::new(synth);
    sequencer.play(&midi, false);
    let count = (seconds * f64::from(rate)).ceil() as usize;
    let mut samples = vec![0.0; count * 2];
    let (left, right) = samples.split_at_mut(count);
    sequencer.render(left, right);
    Ok(samples)
}
