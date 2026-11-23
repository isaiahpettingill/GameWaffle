use crate::{
    Game,
    sound::{Samples, decode},
};
use std::{collections::BTreeMap, rc::Rc};

struct Voice {
    sample: Rc<Samples>,
    position: u64,
    gain: f32,
    looping: bool,
}

#[derive(Default)]
pub(super) struct Audio {
    cache: BTreeMap<String, Option<Rc<Samples>>>,
    voices: Vec<Voice>,
    tracks: [Option<String>; 2],
}

impl Audio {
    fn play(&mut self, game: &Game, id: &str, gain: f32, looping: bool) {
        if self.voices.len() >= 16 {
            return;
        }
        let Some(sound) = game.media.audio.get(id) else {
            return;
        };
        if !self.cache.contains_key(id) {
            let sample = decode(sound)
                .map_err(|err| eprintln!("GameWaffle audio {id}: {err}"))
                .ok()
                .filter(|s| s.channels > 0 && s.rate > 0 && s.pcm.len() >= usize::from(s.channels))
                .map(Rc::new);
            self.cache.insert(id.to_owned(), sample);
        }
        if let Some(sample) = &self.cache[id] {
            self.voices.push(Voice {
                sample: sample.clone(),
                position: 0,
                gain,
                looping,
            });
        }
    }
    pub fn frame(&mut self, game: &Game, output: &mut [i16; 1600]) {
        let room = &game.media.rooms[game.runtime.room()];
        if self.tracks[0] != room.music || self.tracks[1] != room.ambience {
            self.voices.retain(|v| !v.looping);
            self.tracks = [room.music.clone(), room.ambience.clone()];
            if let Some(id) = &room.music {
                self.play(game, id, 0.55, true);
            }
            if let Some(id) = &room.ambience {
                self.play(game, id, 0.4, true);
            }
        }
        for id in game.runtime.sounds() {
            self.play(game, id, 0.65, false);
        }
        let mut mix = [0f32; 1600];
        self.voices.retain_mut(|v| {
            let channels = usize::from(v.sample.channels);
            let end = (v.sample.pcm.len() / channels) as u64 * 48000;
            for pair in mix.chunks_exact_mut(2) {
                if v.position >= end {
                    if !v.looping {
                        return false;
                    }
                    v.position %= end;
                }
                let i = (v.position / 48000) as usize * channels;
                pair[0] += v.sample.pcm[i] * v.gain;
                pair[1] += v.sample.pcm[i + usize::from(channels > 1)] * v.gain;
                v.position += u64::from(v.sample.rate);
            }
            true
        });
        for (out, sample) in output.iter_mut().zip(mix) {
            *out = (sample.clamp(-1., 1.) * 32767.).round() as i16;
        }
    }
}
