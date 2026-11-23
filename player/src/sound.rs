use crate::media::Sound;
use sdl3::{
    AudioSubsystem,
    audio::{AudioFormat, AudioSpec, AudioStreamOwner},
};
use std::{collections::BTreeMap, io::Cursor, rc::Rc};
use symphonia::core::{
    audio::SampleBuffer, formats::FormatOptions, io::MediaSourceStream, meta::MetadataOptions,
    probe::Hint,
};

const SAMPLE_LIMIT: usize = 32 * 1024 * 1024;
type Error = Box<dyn std::error::Error>;
pub(super) struct Samples {
    pub(super) channels: u8,
    pub(super) rate: u32,
    pub(super) pcm: Vec<f32>,
}

fn decode_opus(bytes: &[u8]) -> Result<Samples, Error> {
    let mut source = ogg::PacketReader::new(Cursor::new(bytes));
    let header = source.read_packet_expected()?;
    if header.data.len() < 19 || !header.data.starts_with(b"OpusHead") || header.data[18] != 0 {
        return Err("Use mono or stereo Ogg Opus with channel mapping 0".into());
    }
    let channels = header.data[9];
    let count = usize::from(channels);
    let skip = usize::from(u16::from_le_bytes([header.data[10], header.data[11]]));
    let gain =
        10f32.powf(f32::from(i16::from_le_bytes([header.data[16], header.data[17]])) / 5120.);
    let mut decoder = opus_decoder::OpusDecoder::new(48000, count)?;
    let tags = source.read_packet_expected()?;
    if !tags.data.starts_with(b"OpusTags") {
        return Err("Opus tags are missing".into());
    }
    let mut pcm = Vec::new();
    let mut buffer = [0.; 11520];
    let mut remaining = skip;
    while let Some(packet) = source.read_packet()? {
        if packet.stream_serial() != header.stream_serial() {
            continue;
        }
        let samples = decoder.decode_float(&packet.data, &mut buffer, false)?;
        let start = remaining.min(samples);
        remaining -= start;
        pcm.extend(
            buffer[start * count..samples * count]
                .iter()
                .map(|v| *v * gain),
        );
        if pcm.len() > SAMPLE_LIMIT {
            return Err("Audio exceeds sample limit".into());
        }
        if packet.last_in_stream() && packet.absgp_page() != u64::MAX {
            let length = packet.absgp_page().saturating_sub(skip as u64);
            if length <= SAMPLE_LIMIT as u64 {
                pcm.truncate(length as usize * count);
            }
            break;
        }
    }
    Ok(Samples {
        channels,
        rate: 48000,
        pcm,
    })
}

pub(super) fn decode(sound: &Sound) -> Result<Samples, Error> {
    if sound.format == "qoa" {
        let input = &sound.data;
        let first = input.get(8..16).ok_or("Missing QOA frame")?;
        let channels = first[0];
        let rate = u32::from_be_bytes([0, first[1], first[2], first[3]]);
        if !(1..=2).contains(&channels) || !(8000..=384000).contains(&rate) {
            return Err("Unsupported QOA format".into());
        }
        let mut decoder = qoa::Decoder::<2>::new();
        let mut pcm = Vec::new();
        let mut at = 0;
        let mut buffer = [0; 10240];
        while at < input.len() {
            let result = decoder
                .decode(&input[at..], &mut buffer)
                .map_err(|e| format!("QOA: {e:?}"))?;
            if result.consumed == 0 && result.produced == 0 {
                break;
            }
            at += result.consumed;
            pcm.extend(
                buffer[..result.produced]
                    .iter()
                    .map(|&value| f32::from(value) / 32768.),
            );
            if pcm.len() > SAMPLE_LIMIT {
                return Err("Audio exceeds sample limit".into());
            }
        }
        return Ok(Samples {
            channels,
            rate,
            pcm,
        });
    }
    if sound.format == "opus" || sound.data.get(28..36) == Some(b"OpusHead") {
        return decode_opus(&sound.data);
    }
    let source = MediaSourceStream::new(
        Box::new(Cursor::new(sound.data.clone())),
        Default::default(),
    );
    let mut format = symphonia::default::get_probe()
        .format(
            &Hint::new(),
            source,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )?
        .format;
    let track = format.default_track().ok_or("Audio track is missing")?;
    let id = track.id;
    let channels = track
        .codec_params
        .channels
        .ok_or("Audio channels are missing")?
        .count() as u8;
    let rate = track
        .codec_params
        .sample_rate
        .ok_or("Audio sample rate is missing")?;
    let mut decoder =
        symphonia::default::get_codecs().make(&track.codec_params, &Default::default())?;
    let mut pcm = Vec::new();
    loop {
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(symphonia::core::errors::Error::IoError(e))
                if e.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break;
            }
            Err(e) => return Err(e.into()),
        };
        if packet.track_id() != id {
            continue;
        }
        let data = decoder.decode(&packet)?;
        let mut samples = SampleBuffer::<f32>::new(data.capacity() as u64, *data.spec());
        samples.copy_interleaved_ref(data);
        pcm.extend_from_slice(samples.samples());
        if pcm.len() > SAMPLE_LIMIT {
            return Err("Audio exceeds sample limit".into());
        }
    }
    Ok(Samples {
        channels,
        rate,
        pcm,
    })
}

struct Voice {
    stream: AudioStreamOwner,
    data: Rc<Samples>,
    looping: bool,
    cursor: usize,
}

pub struct Mixer {
    audio: Option<AudioSubsystem>,
    decoded: BTreeMap<String, Rc<Samples>>,
    voices: Vec<Voice>,
    tracks: [Option<String>; 2],
}

impl Mixer {
    pub fn new(audio: Option<AudioSubsystem>) -> Self {
        Self {
            audio,
            decoded: BTreeMap::new(),
            voices: Vec::new(),
            tracks: Default::default(),
        }
    }
    pub fn play(
        &mut self,
        id: &str,
        sounds: &BTreeMap<String, Sound>,
        looping: bool,
        gain: f32,
    ) -> Result<(), Error> {
        let Some(audio) = &self.audio else {
            return Ok(());
        };
        let Some(sound) = sounds.get(id) else {
            return Ok(());
        };
        if self.voices.len() >= 16 {
            return Ok(());
        }
        if !self.decoded.contains_key(id) {
            self.decoded.insert(id.to_owned(), Rc::new(decode(sound)?));
        }
        let data = self.decoded[id].clone();
        if data.pcm.is_empty() {
            return Ok(());
        }
        let spec = AudioSpec::new(
            Some(data.rate as i32),
            Some(data.channels as i32),
            Some(AudioFormat::f32_sys()),
        );
        let stream = audio
            .default_playback_device()
            .open_device_stream(Some(&spec))?;
        stream.set_gain(gain)?;
        stream.resume()?;
        self.voices.push(Voice {
            stream,
            data,
            looping,
            cursor: 0,
        });
        Ok(())
    }
    pub fn room(&mut self, music: Option<&str>, ambience: Option<&str>) -> bool {
        if self.tracks[0].as_deref() == music && self.tracks[1].as_deref() == ambience {
            return false;
        }
        self.tracks = [music.map(str::to_owned), ambience.map(str::to_owned)];
        self.voices.retain(|voice| !voice.looping);
        true
    }
    pub fn reset(&mut self) {
        self.voices.clear();
        self.decoded.clear();
        self.tracks = Default::default();
    }
    pub fn update(&mut self) {
        self.voices.retain_mut(|voice| {
            let Ok(queued) = voice.stream.queued_bytes() else {
                return false;
            };
            if queued as usize >= voice.data.rate as usize * voice.data.channels as usize / 2 {
                return true;
            }
            let pcm = &voice.data.pcm;
            if voice.cursor == pcm.len() {
                if !voice.looping {
                    return queued > 0;
                }
                voice.cursor = 0;
            }
            let end = (voice.cursor + 4096).min(pcm.len());
            if voice.stream.put_data_f32(&pcm[voice.cursor..end]).is_err() {
                return false;
            }
            voice.cursor = end;
            true
        });
    }
}
