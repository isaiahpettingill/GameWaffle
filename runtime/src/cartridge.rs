use std::borrow::Cow;

pub const MAX_CARTRIDGE: usize = 256 * 1024 * 1024;
pub const SIGNATURE_SIZE: usize = 96;
const MAX_SIMULATION: usize = 32 * 1024 * 1024;
const MAX_CARD: usize = 2 * 1024 * 1024 + 8192;

pub struct Sections<'a> {
    pub card: Option<&'a [u8]>,
    simulation: &'a [u8],
    simulation_size: usize,
    media: &'a [u8],
    media_size: usize,
}

impl<'a> Sections<'a> {
    /// Split the cartridge payload after the signature footer has been removed.
    pub fn read(payload: &'a [u8]) -> Result<Self, &'static str> {
        if payload.len() > MAX_CARTRIDGE - SIGNATURE_SIZE {
            return Err("Cartridge exceeds 256 MiB");
        }
        let size_at =
            |offset| u32::from_le_bytes(payload[offset..offset + 4].try_into().unwrap()) as usize;
        let (header, card_size, media_size) = match payload.get(..6) {
            Some(b"GWAF\x00\x02") if payload.len() >= 14 => (14usize, 0, 0),
            Some(b"GWAF\x00\x03") if payload.len() >= 22 => {
                let card_size = size_at(14);
                if card_size == 0 || card_size > MAX_CARD {
                    return Err("Invalid cartridge display data length");
                }
                (22, card_size, size_at(18))
            }
            _ => return Err("Unsupported cartridge format"),
        };
        let simulation_size = size_at(10);
        let simulation_start = header + card_size;
        let simulation_packed = size_at(6);
        let media_start = simulation_start
            .checked_add(simulation_packed)
            .ok_or("Invalid cartridge section lengths")?;
        if simulation_packed == 0
            || simulation_size == 0
            || simulation_size > MAX_SIMULATION
            || media_start >= payload.len()
            || media_size > MAX_CARTRIDGE
        {
            return Err("Invalid cartridge section lengths");
        }
        Ok(Self {
            card: (card_size != 0).then(|| &payload[header..simulation_start]),
            simulation: &payload[simulation_start..media_start],
            simulation_size,
            media: &payload[media_start..],
            media_size,
        })
    }

    pub fn simulation(&self) -> Result<Vec<u8>, &'static str> {
        inflate(self.simulation, self.simulation_size)
    }

    pub fn media(&self) -> Result<Cow<'a, [u8]>, &'static str> {
        if self.media_size == 0 {
            return Ok(Cow::Borrowed(self.media));
        }
        inflate(self.media, self.media_size).map(Cow::Owned)
    }
}

fn inflate(bytes: &[u8], size: usize) -> Result<Vec<u8>, &'static str> {
    let plain = miniz_oxide::inflate::decompress_to_vec_with_limit(bytes, size)
        .map_err(|_| "Cannot decompress cartridge section")?;
    if plain.len() != size {
        return Err("Invalid expanded cartridge section length");
    }
    Ok(plain)
}
